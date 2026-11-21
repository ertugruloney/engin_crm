"""Taksitli satışlarda paranın bugünkü değerine göre zarar hesabı.

Satış günü (arsanın mevcut aşamaya geçtiği gün) referans alınır. Kapora ve peşinat o gün
ödenmiş sayılır; her taksit vade tarihine kadar geçen ay sayısı kadar aylık faizle iskonto edilir:
    bugünkü değer = kapora + peşinat + Σ taksit / (1 + r) ^ ay
    zarar = satış bedeli - bugünkü değer
"""
from datetime import date
from decimal import Decimal

from .models import FinanceSettings

AVERAGE_DAYS_PER_MONTH = 365.25 / 12


def monthly_interest_rate():
    value = FinanceSettings.objects.filter(pk=1).values_list('monthly_interest_rate', flat=True).first()
    return value if value is not None else Decimal('0')


def sale_reference_date(land):
    history = list(land.status_history.all())
    for entry in reversed(history):
        if entry.status == land.status:
            return entry.transitioned_at.date()
    return date.today()


def installment_loss(land, rate_percent):
    """Taksit planı yoksa ya da faiz 0 ise None döner."""
    plan = land.installment_plan or []
    if not plan or land.sale_price is None or rate_percent is None or rate_percent <= 0:
        return None

    rate = float(rate_percent) / 100
    reference = sale_reference_date(land)
    upfront = float(land.deposit_amount or 0) + float(land.down_payment or 0)
    present_value = upfront
    for item in plan:
        due = date.fromisoformat(str(item['due_date']))
        months = max(0.0, (due - reference).days / AVERAGE_DAYS_PER_MONTH)
        present_value += float(item['amount']) / (1 + rate) ** months

    sale_price = float(land.sale_price)
    loss = sale_price - present_value
    return {
        'monthly_interest_rate': str(rate_percent),
        'reference_date': reference.isoformat(),
        'present_value': f'{present_value:.2f}',
        'loss_amount': f'{loss:.2f}',
        'loss_percent': round(loss / sale_price * 100, 2) if sale_price else None,
    }
