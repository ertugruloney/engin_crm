import unicodedata

from django.db import migrations
from django.utils import timezone

STATUS_RANK = {'BOS': 0, 'REZERV': 1, 'KAPORA_ALINDI': 2, 'TAPU': 3}


def normalize_phone(phone):
    digits = ''.join(character for character in str(phone or '') if character.isdigit())
    if len(digits) == 10 and digits.startswith('5'):
        return f'90{digits}'
    if len(digits) == 11 and digits.startswith('0'):
        return f'9{digits}'
    return digits


def normalize_name(name):
    value = unicodedata.normalize('NFKD', str(name or '').casefold().replace('ı', 'i'))
    return ' '.join(''.join(character for character in value if not unicodedata.combining(character)).split())


def backfill_customers(apps, schema_editor):
    """Müşterisi olan mevcut arsalar için müşteri kartı ve müşteri-arsa kaydı oluşturur."""
    Land = apps.get_model('lands', 'Land')
    Customer = apps.get_model('lands', 'Customer')
    CustomerLandRecord = apps.get_model('lands', 'CustomerLandRecord')

    by_phone = {}
    by_name = {}
    lands = Land.objects.exclude(status='BOS').exclude(customer_name='').prefetch_related('status_history')
    for land in lands.order_by('id'):
        name = land.customer_name.strip()
        if not name:
            continue
        phone_key = normalize_phone(land.customer_phone)
        customer = by_phone.get(phone_key) if phone_key else by_name.get(normalize_name(name))
        if customer is None:
            customer = Customer.objects.create(full_name=name, phone=land.customer_phone.strip(), phone_key=phone_key)
            if phone_key:
                by_phone[phone_key] = customer
            else:
                by_name[normalize_name(name)] = customer
        land.customer = customer
        land.save(update_fields=['customer'])

        history = sorted(land.status_history.all(), key=lambda entry: entry.transitioned_at)
        started_at = history[0].transitioned_at if history else timezone.now()
        sold_at = next((entry.transitioned_at for entry in reversed(history) if entry.status == 'TAPU'), None)
        highest = max([land.status, *(entry.status for entry in history)], key=lambda status: STATUS_RANK[status])
        CustomerLandRecord.objects.create(
            customer=customer,
            land=land,
            land_label=f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}',
            il=land.il,
            ilce=land.ilce,
            highest_status=highest,
            outcome='sold' if land.status == 'TAPU' else 'active',
            deposit_amount=land.deposit_amount,
            sale_price=land.sale_price,
            started_at=started_at,
            ended_at=(sold_at or timezone.now()) if land.status == 'TAPU' else None,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('lands', '0014_customers'),
    ]

    operations = [
        migrations.RunPython(backfill_customers, migrations.RunPython.noop),
    ]
