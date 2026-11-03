"""Gösterge paneli için örnek (demo) veri üretir.

Kullanım:
    python manage.py seed_demo          # demo veriyi ekler (varsa önce eskisini siler)
    python manage.py seed_demo --clear  # sadece demo veriyi siler

Demo arsaların notu "[DEMO]" ile başlar, demo denetim kayıtlarında changes.demo = True
bulunur ve demo kullanıcı adları "demo." ile başlar; gerçek veriye dokunulmaz.
"""
import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from lands.auth_views import VIEWER_GROUP
from lands.models import AuditLog, Land, LandStatusHistory

DEMO_NOTE = '[DEMO] Örnek veri'
DEMO_USER_PREFIX = 'demo.'
DEMO_PASSWORD = 'Demo-sifre-2026'

# il: (ilçeler, ağırlık, fiyat çarpanı)
CITIES = {
    'İstanbul': (['Başakşehir', 'Arnavutköy', 'Silivri', 'Çatalca', 'Beylikdüzü', 'Sancaktepe'], 30, 1.6),
    'Ankara': (['Çankaya', 'Gölbaşı', 'Etimesgut', 'İncek', 'Yenimahalle'], 16, 1.1),
    'İzmir': (['Çeşme', 'Urla', 'Seferihisar', 'Menderes', 'Torbalı'], 14, 1.3),
    'Antalya': (['Kepez', 'Konyaaltı', 'Döşemealtı', 'Manavgat', 'Alanya'], 11, 1.2),
    'Bursa': (['Nilüfer', 'Osmangazi', 'Mudanya', 'Gemlik'], 9, 1.0),
    'Muğla': (['Bodrum', 'Fethiye', 'Marmaris', 'Datça'], 6, 1.5),
    'Kocaeli': (['Gebze', 'Kartepe', 'Başiskele'], 5, 0.9),
    'Tekirdağ': (['Çerkezköy', 'Çorlu', 'Süleymanpaşa'], 5, 0.8),
    'Sakarya': (['Sapanca', 'Serdivan'], 3, 0.8),
    'Konya': (['Selçuklu', 'Meram'], 3, 0.6),
    'Mersin': (['Mezitli', 'Yenişehir'], 3, 0.7),
    'Trabzon': (['Ortahisar', 'Akçaabat'], 2, 0.7),
    'Gaziantep': (['Şahinbey', 'Şehitkamil'], 2, 0.6),
    'Eskişehir': (['Tepebaşı', 'Odunpazarı'], 2, 0.6),
}

REPRESENTATIVES = [
    ('demo.ahmet.yilmaz', 'Ahmet', 'Yılmaz', 30),
    ('demo.mehmet.kaya', 'Mehmet', 'Kaya', 25),
    ('demo.zeynep.demir', 'Zeynep', 'Demir', 20),
    ('demo.burak.arslan', 'Burak', 'Arslan', 15),
    ('demo.selin.akin', 'Selin', 'Akın', 10),
]

FIRST_NAMES = ['Ali', 'Ayşe', 'Fatma', 'Mustafa', 'Emre', 'Elif', 'Can', 'Deniz', 'Hakan', 'Merve', 'Oğuz', 'Seda',
               'Kemal', 'Gül', 'Murat', 'Ebru', 'Serkan', 'Derya', 'Volkan', 'Nur']
LAST_NAMES = ['Öztürk', 'Çelik', 'Şahin', 'Yıldız', 'Aydın', 'Koç', 'Kurt', 'Polat', 'Erdoğan', 'Güneş', 'Aksoy',
              'Bulut', 'Kılıç', 'Doğan', 'Tekin']
MAHALLELER = ['Merkez', 'Cumhuriyet', 'Yeni', 'Atatürk', 'Fatih', 'Yıldırım', 'Gazi', 'İstiklal', 'Bahçelievler']

LAND_COUNT = 170
# Durum dağılımı (toplam LAND_COUNT)
STATUS_PLAN = ['TAPU'] * 70 + ['KAPORA_ALINDI'] * 25 + ['REZERV'] * 30 + ['BOS'] * 45


class Command(BaseCommand):
    help = 'Gösterge paneli için örnek arsa, satış, temsilci ve aktivite verisi ekler.'

    def add_arguments(self, parser):
        parser.add_argument('--clear', action='store_true', help='Sadece demo veriyi siler.')

    @transaction.atomic
    def handle(self, *args, **options):
        removed = self.clear()
        if removed:
            self.stdout.write(f'Önceki demo veri silindi: {removed} arsa.')
        if options['clear']:
            return
        self.seed()

    def clear(self):
        demo_lands = Land.objects.filter(reservation_notes__startswith='[DEMO]')
        count = demo_lands.count()
        AuditLog.objects.filter(changes__demo=True).delete()
        demo_lands.delete()
        User.objects.filter(username__startswith=DEMO_USER_PREFIX).delete()
        return count

    def seed(self):
        rng = random.Random(2026)
        now = timezone.now()
        admin = User.objects.filter(is_superuser=True).order_by('id').first() or User.objects.filter(is_staff=True).first()
        admin_name = admin.username if admin else 'admin'

        group, _ = Group.objects.get_or_create(name=VIEWER_GROUP)
        reps = []
        for username, first, last, weight in REPRESENTATIVES:
            user = User.objects.create_user(username=username, password=DEMO_PASSWORD, first_name=first, last_name=last)
            user.groups.add(group)
            reps.append((user, weight))

        city_names = list(CITIES)
        city_weights = [CITIES[name][1] for name in city_names]
        statuses = STATUS_PLAN[:]
        rng.shuffle(statuses)

        audit_rows = []
        todays: dict = {}

        def log(actor, actor_name, land, label, old, new, at, extra=None):
            changes = {'land_label': label, 'status': {'old': old, 'new': new}, 'demo': True}
            if extra:
                changes.update(extra)
            audit_rows.append((AuditLog(
                actor=actor,
                actor_username=actor_name,
                action='land.status_changed',
                target_type='land',
                target_id=str(land.pk),
                changes=changes,
            ), at))

        def recent_moment(max_days):
            # Son günlere daha yoğun dağılım; "Bugün" ve "Bu Hafta" da boş kalmasın.
            days = min(max_days, int(rng.betavariate(1.1, 2.2) * max_days))
            return now - timedelta(days=days, hours=rng.randint(0, 20), minutes=rng.randint(0, 59))

        for index, status in enumerate(statuses):
            il = rng.choices(city_names, weights=city_weights)[0]
            districts, _, multiplier = CITIES[il]
            ilce = rng.choice(districts)
            price = Decimal(round(rng.uniform(1.2, 6.5) * multiplier * 1_000_000, -4))
            customer = f'{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}' if status != 'BOS' else ''
            rep, _ = rng.choices(reps, weights=[weight for _, weight in reps])[0]

            land = Land.objects.create(
                il=il,
                ilce=ilce,
                mahalle=f'{rng.choice(MAHALLELER)} Mah.',
                ada=str(rng.randint(100, 999)),
                parsel=str(index + 1),
                status=status,
                is_reserved=status != 'BOS',
                reservation_notes=DEMO_NOTE,
                customer_name=customer,
                customer_phone=f'+90 5{rng.randint(30, 59)} {rng.randint(100, 999)} {rng.randint(10, 99)} {rng.randint(10, 99)}' if customer else '',
                sale_price=price if status in ('TAPU', 'KAPORA_ALINDI') or rng.random() < 0.3 else None,
                deposit_amount=(price * Decimal('0.1')).quantize(Decimal('1')) if status in ('TAPU', 'KAPORA_ALINDI') else None,
            )
            label = f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}'
            if status == 'BOS':
                continue

            # Zaman çizelgesi: rezerv -> (kapora) -> (tapu); en son adım yakın geçmişte.
            # Her durumdan ilk birkaç arsanın son adımı bugüne düşer.
            todays[status] = todays.get(status, 0) + 1
            if todays[status] <= 3:
                last = now - timedelta(hours=rng.randint(0, 8), minutes=rng.randint(5, 59))
            else:
                last = recent_moment(400 if status == 'TAPU' else 60)
            steps = ['REZERV', 'KAPORA_ALINDI', 'TAPU'][: ['REZERV', 'KAPORA_ALINDI', 'TAPU'].index(status) + 1]
            moments = [last]
            for _ in steps[:-1]:
                moments.insert(0, moments[0] - timedelta(days=rng.randint(3, 25), hours=rng.randint(0, 12)))
            land.reservation_date = moments[0].date()
            land.save(update_fields=['reservation_date'])

            previous = 'BOS'
            for step, moment in zip(steps, moments):
                history = LandStatusHistory.objects.create(land=land, status=step)
                LandStatusHistory.objects.filter(pk=history.pk).update(transitioned_at=moment)
                if step == 'REZERV':
                    log(rep, rep.username, land, label, previous, step, moment,
                        {'customer_name': {'old': '', 'new': customer}})
                else:
                    log(admin, admin_name, land, label, previous, step, moment)
                previous = step

        for entry, _ in audit_rows:
            entry.save()
        for entry, moment in audit_rows:
            AuditLog.objects.filter(pk=entry.pk).update(created_at=moment)

        sold = Land.objects.filter(reservation_notes__startswith='[DEMO]', status='TAPU')
        total = sum((land.sale_price or 0) for land in sold)
        self.stdout.write(self.style.SUCCESS(
            f'{len(statuses)} demo arsa, {len(reps)} demo temsilci ve {len(audit_rows)} aktivite eklendi. '
            f'Toplam satış: ₺{total:,.0f}. Demo temsilci şifresi: {DEMO_PASSWORD}'
        ))
