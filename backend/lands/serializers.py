from decimal import Decimal

from rest_framework import serializers
from django.utils import timezone
from django.core.validators import FileExtensionValidator
from .models import Land, LandStatusHistory


def clear_reservation_when_available(attrs):
    if attrs.get('status') == 'BOS':
        attrs.update({
            'reservation_date': None,
            'customer_name': '',
            'customer_phone': '',
            'deposit_amount': None,
        })
    return attrs


def validate_deposit_amount(attrs, instance):
    entering_deposit_stage = (
        attrs.get('status') == 'KAPORA_ALINDI'
        and (instance is None or instance.status != 'KAPORA_ALINDI')
    )
    if entering_deposit_stage:
        deposit_amount = attrs.get(
            'deposit_amount',
            instance.deposit_amount if instance is not None else None,
        )
        if deposit_amount is None or deposit_amount <= 0:
            raise serializers.ValidationError({
                'deposit_amount': 'Kapora aşamasına geçmek için sıfırdan büyük kapora tutarı girilmelidir.'
            })


class LandStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = LandStatusHistory
        fields = ['id', 'status', 'transitioned_at']


class RepresentativeLandSerializer(serializers.ModelSerializer):
    class Meta:
        model = Land
        fields = [
            'id',
            'il',
            'ilce',
            'mahalle',
            'ada',
            'parsel',
            'status',
            'reservation_date',
            'customer_name',
            'customer_phone',
            'reservation_notes',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self.context.get('show_reservation_details', False):
            for field in ('reservation_date', 'customer_name', 'customer_phone', 'reservation_notes'):
                data.pop(field, None)
        return data


class RepresentativeLandNotesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Land
        fields = ['reservation_notes']


class LandReservationSerializer(serializers.ModelSerializer):
    reservation_date = serializers.DateField(default=timezone.localdate)
    customer_name = serializers.CharField(max_length=200, allow_blank=False, trim_whitespace=True)
    customer_phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default='')

    class Meta:
        model = Land
        fields = [
            'reservation_date',
            'customer_name',
            'customer_phone',
        ]


class LandSerializer(serializers.ModelSerializer):
    status_history = serializers.SerializerMethodField()

    class Meta:
        model = Land
        fields = '__all__'

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('hide_reservation_details', False):
            for field in ('reservation_date', 'customer_name', 'customer_phone', 'reservation_notes'):
                data.pop(field, None)
        return data

    def get_status_history(self, land):
        return LandStatusHistorySerializer(land.status_history.all(), many=True).data

    def validate(self, attrs):
        attrs = clear_reservation_when_available(attrs)
        validate_deposit_amount(attrs, self.instance)
        validate_sale_price(attrs, self.instance)
        validate_installment_plan(attrs, self.instance)
        return attrs


def validate_sale_price(attrs, instance):
    sale_price = attrs.get('sale_price', instance.sale_price if instance is not None else None)
    if sale_price is not None and sale_price <= 0:
        raise serializers.ValidationError({
            'sale_price': 'Satış bedeli sıfırdan büyük olmalıdır.'
        })
    entering_title_deed_stage = (
        attrs.get('status') == 'TAPU'
        and (instance is None or instance.status != 'TAPU')
    )
    if entering_title_deed_stage and sale_price is None:
        raise serializers.ValidationError({
            'sale_price': 'Tapu aşamasına geçmek için satış bedeli girilmelidir.'
        })


def validate_installment_plan(attrs, instance):
    plan = attrs.get('installment_plan', instance.installment_plan if instance is not None else [])
    if not isinstance(plan, list):
        raise serializers.ValidationError({
            'installment_plan': 'Taksit planı liste biçiminde olmalıdır.'
        })
    if not plan:
        return

    item_serializer = InstallmentItemSerializer(data=plan, many=True)
    item_serializer.is_valid(raise_exception=True)
    items = item_serializer.validated_data
    amounts = [item['amount'] for item in items]
    if any(amount <= 0 for amount in amounts):
        raise serializers.ValidationError({
            'installment_plan': 'Taksit tutarları sıfırdan büyük olmalıdır.'
        })

    sale_price = attrs.get('sale_price', instance.sale_price if instance is not None else None)
    deposit_amount = attrs.get('deposit_amount', instance.deposit_amount if instance is not None else None)
    if sale_price is None:
        raise serializers.ValidationError({
            'sale_price': 'Taksit planı için satış bedeli girilmelidir.'
        })
    upfront_amount = deposit_amount or Decimal('0')
    remaining_amount = sale_price - upfront_amount
    if remaining_amount <= 0 or sum(amounts) != remaining_amount:
        raise serializers.ValidationError({
            'installment_plan': 'Taksitlerin toplamı, peşinat düşüldükten sonraki kalan satış bedeline eşit olmalıdır.'
        })


class InstallmentItemSerializer(serializers.Serializer):
    due_date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0.01'))


class LandStatusSerializer(serializers.ModelSerializer):
    title_deed_image = serializers.ImageField(
        required=False,
        allow_null=True,
        validators=[FileExtensionValidator(['jpg', 'jpeg', 'png', 'webp'])],
    )

    class Meta:
        model = Land
        fields = [
            'status',
            'reservation_date',
            'customer_name',
            'customer_phone',
            'reservation_notes',
            'deposit_amount',
            'sale_price',
            'installment_plan',
            'title_deed_image',
        ]

    def validate(self, attrs):
        attrs = clear_reservation_when_available(attrs)
        validate_deposit_amount(attrs, self.instance)
        validate_sale_price(attrs, self.instance)
        validate_installment_plan(attrs, self.instance)
        validate_title_deed_image(attrs, self.instance)
        return attrs


def validate_title_deed_image(attrs, instance):
    image = attrs.get('title_deed_image')
    if image and image.size > 10 * 1024 * 1024:
        raise serializers.ValidationError({
            'title_deed_image': 'Tapu görseli 10 MB boyutunu aşamaz.'
        })
    if (
        attrs.get('status') == 'TAPU'
        and (instance is None or instance.status != 'TAPU')
        and not image
        and (instance is None or not instance.title_deed_image)
    ):
        raise serializers.ValidationError({
            'title_deed_image': 'Tapu aşamasına geçmek için tapu görseli yüklenmelidir.'
        })
