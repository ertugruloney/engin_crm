"""Arsadaki müşteri bilgisini kalıcı müşteri kartına ve müşteri-arsa kayıtlarına yansıtır.

Rezervasyon hangi ekrandan yapılırsa yapılsın arsa kaydedildikten sonra sync_land_customer çağrılır:
- Arsa bir müşteriyle rezerv/kapora/tapu aşamasındaysa müşteri telefonla (yoksa adla) bulunur ya da
  oluşturulur, arsaya bağlanır ve o arsa için açık bir kayıt tutulur.
- Arsa boşa alınınca bağlantı kopar; kayıt "iptal edildi" olarak kalır, müşteri silinmez.
"""
import unicodedata

from django.utils import timezone

from .models import Customer, CustomerLandRecord

STATUS_RANK = {'BOS': 0, 'REZERV': 1, 'KAPORA_ALINDI': 2, 'TAPU': 3}


def normalize_phone(phone):
    """Telefonu eşleştirme anahtarına çevirir: 0532..., +90 532..., 532... -> 90532..."""
    digits = ''.join(character for character in str(phone or '') if character.isdigit())
    if len(digits) == 10 and digits.startswith('5'):
        return f'90{digits}'
    if len(digits) == 11 and digits.startswith('0'):
        return f'9{digits}'
    return digits


def normalize_name(name):
    value = unicodedata.normalize('NFKD', str(name or '').casefold().replace('ı', 'i'))
    return ' '.join(''.join(character for character in value if not unicodedata.combining(character)).split())


def land_label(land):
    return f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}'


def find_or_create_customer(full_name, phone):
    """Aynı telefon numarası tek müşteridir; telefon yoksa aynı adlı ve telefonsuz müşteri aranır."""
    full_name = (full_name or '').strip()
    phone = (phone or '').strip()
    phone_key = normalize_phone(phone)
    if phone_key:
        customer = Customer.objects.filter(phone_key=phone_key).order_by('id').first()
    else:
        name_key = normalize_name(full_name)
        customer = next(
            (item for item in Customer.objects.filter(phone_key='').order_by('id') if normalize_name(item.full_name) == name_key),
            None,
        )
    if customer:
        return customer, False
    return Customer.objects.create(full_name=full_name, phone=phone, phone_key=phone_key), True


def _resolve_customer(land):
    """Arsadaki ad/telefona karşılık gelen müşteriyi döndürür.

    Arsa zaten bir müşteriye bağlıysa ve ad ya da telefon hâlâ ona aitse bu bir düzeltmedir;
    müşteri kartı güncellenir. İkisi de değiştiyse arsa başka birine geçmiştir.
    """
    current = land.customer
    phone_key = normalize_phone(land.customer_phone)
    if current is not None:
        same_phone = bool(phone_key) and phone_key == current.phone_key
        same_name = normalize_name(land.customer_name) == normalize_name(current.full_name)
        other = Customer.objects.filter(phone_key=phone_key).exclude(pk=current.pk).first() if phone_key else None
        if (same_phone or same_name) and other is None:
            changed = []
            if land.customer_name.strip() and land.customer_name.strip() != current.full_name:
                current.full_name = land.customer_name.strip()
                changed.append('full_name')
            if land.customer_phone.strip() != current.phone and (phone_key or not current.phone_key):
                current.phone = land.customer_phone.strip()
                current.phone_key = phone_key
                changed += ['phone', 'phone_key']
            if changed:
                current.save(update_fields=[*changed, 'updated_at'])
            return current
    customer, _ = find_or_create_customer(land.customer_name, land.customer_phone)
    return customer


def _close_open_records(land, exclude_customer_id=None, cancel_reason='', cancel_detail='', cancel_note=''):
    records = CustomerLandRecord.objects.filter(land=land, outcome='active')
    if exclude_customer_id is not None:
        records = records.exclude(customer_id=exclude_customer_id)
    records.update(
        outcome='cancelled',
        ended_at=timezone.now(),
        cancel_reason=cancel_reason,
        cancel_detail=cancel_detail,
        cancel_note=cancel_note,
    )


def sync_land_customer(land, actor=None, cancel_reason='', cancel_detail='', cancel_note=''):
    """Arsa kaydedildikten sonra çağrılır; müşteri bağlantısını ve müşteri-arsa kaydını günceller.

    Arsa boşa alınıyorsa cancel_reason/cancel_detail/cancel_note açık kayda iptal nedeni olarak yazılır.
    """
    if land.status == 'BOS' or not land.customer_name.strip():
        # Boşa alınan ya da müşterisi silinen arsa: açık kayıt iptal sayılır, müşteri kartı kalır.
        _close_open_records(land, cancel_reason=cancel_reason, cancel_detail=cancel_detail, cancel_note=cancel_note)
        if land.customer_id is not None:
            land.customer = None
            land.save(update_fields=['customer'])
        return None

    customer = _resolve_customer(land)
    _close_open_records(land, exclude_customer_id=customer.pk, cancel_reason='devredildi')
    if land.customer_id != customer.pk:
        land.customer = customer
        land.save(update_fields=['customer'])

    record = (
        CustomerLandRecord.objects.filter(customer=customer, land=land, outcome__in=['active', 'sold'])
        .order_by('-started_at', '-id')
        .first()
    )
    if record is None:
        record = CustomerLandRecord(
            customer=customer,
            land=land,
            representative=actor if actor is not None and actor.is_authenticated else None,
        )
    record.land_label = land_label(land)
    record.il = land.il
    record.ilce = land.ilce
    if STATUS_RANK[land.status] > STATUS_RANK.get(record.highest_status, 0):
        record.highest_status = land.status
    record.deposit_amount = land.deposit_amount
    record.sale_price = land.sale_price
    if land.status == 'TAPU':
        record.outcome = 'sold'
        record.ended_at = record.ended_at or timezone.now()
    else:
        # Tapudan önceki aşamaya dönüldüyse satış geri alınmış demektir.
        record.outcome = 'active'
        record.ended_at = None
    record.save()
    return customer


def sync_customer_to_lands(customer):
    """Müşteri kartı düzenlenince bağlı arsalardaki ad/telefon kopyalarını günceller."""
    customer.lands.update(customer_name=customer.full_name, customer_phone=customer.phone)
