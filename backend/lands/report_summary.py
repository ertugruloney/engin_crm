"""Sunum raporu (PowerPoint / PDF) için özet veriler.

Rakamlar Raporlar sayfasıyla aynı kurallarla hesaplanır:
- Rezerv: dönem içindeki her "Rezerv" adımı sayılır.
- Kapora: arsanın son "Kapora Alındı" adımı dönem içindeyse.
- Satış: arsa hâlâ Tapu aşamasındaysa ve son "Tapu" adımı dönem içindeyse; tutar satış bedelidir.
- Envanter (toplam/boşta) dönemden bağımsız, bugünkü durumdur.
"""
import unicodedata
from collections import defaultdict
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import CANCEL_REASON_LABELS, CustomerLandRecord, Land

# Ekranda/raporda gösterilen saatler için (sunucu saat dilimi UTC olsa da kullanıcı Türkiye saatini görür).
DISPLAY_TIME_ZONE = ZoneInfo(getattr(settings, 'DISPLAY_TIME_ZONE', 'Europe/Istanbul'))

STATUS_LABELS = {'BOS': 'Boşta', 'REZERV': 'Rezerve', 'KAPORA_ALINDI': 'Kapora alındı', 'TAPU': 'Satıldı'}
STATUS_ORDER = ['TAPU', 'KAPORA_ALINDI', 'REZERV', 'BOS']
OWNERSHIP_LABELS = {'MUSTAKIL': 'Müstakil', 'HISSELI': 'Hisseli'}

# frontend/src/regions.ts ile aynı: plaka sırasına göre 81 il ve coğrafi bölgeler.
PROVINCE_NAMES = (
    'adana,adiyaman,afyonkarahisar,agri,amasya,ankara,antalya,artvin,aydin,balikesir,bilecik,bingol,bitlis,bolu,'
    'burdur,bursa,canakkale,cankiri,corum,denizli,diyarbakir,edirne,elazig,erzincan,erzurum,eskisehir,gaziantep,'
    'giresun,gumushane,hakkari,hatay,isparta,mersin,istanbul,izmir,kars,kastamonu,kayseri,kirklareli,kirsehir,'
    'kocaeli,konya,kutahya,malatya,manisa,kahramanmaras,mardin,mugla,mus,nevsehir,nigde,ordu,rize,sakarya,samsun,'
    'siirt,sinop,sivas,tekirdag,tokat,trabzon,tunceli,sanliurfa,usak,van,yozgat,zonguldak,aksaray,bayburt,karaman,'
    'kirikkale,batman,sirnak,bartin,ardahan,igdir,yalova,karabuk,kilis,osmaniye,duzce'
).split(',')
PROVINCE_PLATES = {name: f'{index + 1:02d}' for index, name in enumerate(PROVINCE_NAMES)}
PROVINCE_PLATES.update({'afyon': '03', 'icel': '33', 'maras': '46', 'urfa': '63'})
REGIONS = [
    ('Marmara', '10,11,16,17,22,34,39,41,54,59,77'),
    ('Ege', '03,09,20,35,43,45,48,64'),
    ('Akdeniz', '01,07,15,31,32,33,46,80'),
    ('İç Anadolu', '06,18,26,38,40,42,50,51,58,66,68,70,71'),
    ('Karadeniz', '05,08,14,19,28,29,37,52,53,55,57,60,61,67,69,74,78,81'),
    ('Doğu Anadolu', '04,12,13,23,24,25,30,36,44,49,62,65,75,76'),
    ('Güneydoğu Anadolu', '02,21,27,47,56,63,72,73,79'),
]
REGION_BY_PLATE = {plate: name for name, plates in REGIONS for plate in plates.split(',')}
UNKNOWN_REGION = 'Bilinmeyen'


def _normalize_city(value):
    value = str(value or '').strip().casefold().replace('ı', 'i')
    value = unicodedata.normalize('NFKD', value)
    return ''.join(character for character in value if not unicodedata.combining(character))


def region_of(city):
    return REGION_BY_PLATE.get(PROVINCE_PLATES.get(_normalize_city(city)), UNKNOWN_REGION)


@dataclass
class Metrics:
    lands: int = 0
    available: int = 0
    reservations: int = 0
    deposits: int = 0
    sales: int = 0
    amount: Decimal = Decimal('0')
    shared_sales: int = 0

    def as_dict(self):
        return {
            'lands': self.lands,
            'available': self.available,
            'reservations': self.reservations,
            'deposits': self.deposits,
            'sales': self.sales,
            'amount': self.amount,
            'shared_sales': self.shared_sales,
            'standalone_sales': self.sales - self.shared_sales,
        }


@dataclass
class LandEvents:
    land: Land
    reservations: list = field(default_factory=list)
    deposit: object = None
    sale_at: object = None


def _events(land):
    history = list(land.status_history.all())
    at = lambda status: [entry.transitioned_at for entry in history if entry.status == status]  # noqa: E731
    title_deeds = at('TAPU')
    return LandEvents(
        land=land,
        reservations=at('REZERV'),
        deposit=(at('KAPORA_ALINDI') or [None])[-1],
        sale_at=title_deeds[-1] if land.status == 'TAPU' and title_deeds else None,
    )


def _add(metrics, item, in_range):
    land = item.land
    metrics.lands += 1
    if land.status == 'BOS':
        metrics.available += 1
    metrics.reservations += sum(1 for moment in item.reservations if in_range(moment))
    if item.deposit and in_range(item.deposit):
        metrics.deposits += 1
    if item.sale_at and in_range(item.sale_at):
        metrics.sales += 1
        metrics.amount += land.sale_price or Decimal('0')
        if land.ownership_type == 'HISSELI':
            metrics.shared_sales += 1


def _display_name(username, names):
    full_name = names.get(username, '').strip()
    if full_name:
        return full_name
    parts = [part for part in username.replace('-', '.').replace('_', '.').split('.') if part and part != 'demo']
    return ' '.join(part[:1].upper() + part[1:] for part in parts) or username


def build_report_summary(date_from=None, date_to=None, period_label=''):
    """Sunum için tüm özet tabloları tek sözlükte döndürür."""
    from .auth_views import build_sales_leaderboard

    def in_range(moment):
        day = timezone.localtime(moment).date()
        return (date_from is None or day >= date_from) and (date_to is None or day <= date_to)

    events = [_events(land) for land in Land.objects.prefetch_related('status_history')]

    totals = Metrics()
    by_region = defaultdict(Metrics)
    by_city = defaultdict(Metrics)
    by_ownership = {'MUSTAKIL': Metrics(), 'HISSELI': Metrics()}
    status_counts = {status: 0 for status in STATUS_ORDER}
    shared_parcels = {}
    for item in events:
        land = item.land
        _add(totals, item, in_range)
        _add(by_region[region_of(land.il)], item, in_range)
        _add(by_city[land.il or 'Belirtilmemiş'], item, in_range)
        _add(by_ownership[land.ownership_type if land.ownership_type in by_ownership else 'MUSTAKIL'], item, in_range)
        status_counts[land.status] = status_counts.get(land.status, 0) + 1
        if land.ownership_type == 'HISSELI':
            key = (land.il, land.ilce, land.mahalle, land.ada, land.parsel)
            parcel = shared_parcels.setdefault(key, {
                'place': f'{land.il} / {land.ilce} · {land.mahalle}',
                'parcel': f'Ada {land.ada} / Parsel {land.parsel}',
                'total': 0,
                'counts': {status: 0 for status in STATUS_ORDER},
                'amount': Decimal('0'),
            })
            parcel['total'] += 1
            parcel['counts'][land.status] += 1
            if land.status == 'TAPU':
                parcel['amount'] += land.sale_price or Decimal('0')

    def ranked(groups):
        return sorted(
            ({'name': name, **metrics.as_dict()} for name, metrics in groups.items()),
            key=lambda row: (-row['amount'], -row['sales'], -row['lands'], row['name']),
        )

    full_names = {
        user.username: user.get_full_name()
        for user in get_user_model().objects.filter(is_staff=False).only('username', 'first_name', 'last_name')
    }
    people = [
        {
            'name': _display_name(row['username'], full_names),
            'reservations': row['reservations'],
            'deposits': row['deposits'],
            'sales': row['sales'],
            'amount': Decimal(row['amount']),
        }
        for row in build_sales_leaderboard(date_from, date_to)
    ]

    cancellations = defaultdict(int)
    for record in CustomerLandRecord.objects.filter(outcome='cancelled').exclude(cancel_reason='devredildi'):
        if record.ended_at and in_range(record.ended_at):
            cancellations[CANCEL_REASON_LABELS.get(record.cancel_reason, 'Neden belirtilmemiş')] += 1

    return {
        'period_label': period_label or 'Tüm zamanlar',
        'date_from': date_from,
        'date_to': date_to,
        'generated_at': timezone.localtime(timezone=DISPLAY_TIME_ZONE),
        'totals': totals.as_dict(),
        'status_counts': [
            {'status': status, 'label': STATUS_LABELS[status], 'count': status_counts[status]} for status in STATUS_ORDER
        ],
        'regions': ranked(by_region),
        'cities': ranked(by_city)[:10],
        'ownership': [
            {'type': key, 'name': OWNERSHIP_LABELS[key], **metrics.as_dict()} for key, metrics in by_ownership.items()
        ],
        'shared_parcels': sorted(
            shared_parcels.values(),
            key=lambda parcel: (-parcel['counts']['TAPU'] / parcel['total'], -parcel['amount'], parcel['place']),
        )[:10],
        'shared_parcel_count': len(shared_parcels),
        'people': people[:10],
        'cancellations': sorted(
            ({'reason': reason, 'count': count} for reason, count in cancellations.items()),
            key=lambda row: -row['count'],
        ),
    }
