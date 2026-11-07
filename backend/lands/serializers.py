from decimal import Decimal
from urllib.parse import urlparse

from rest_framework import serializers
from django.utils import timezone
from django.core.validators import FileExtensionValidator
from .customers import normalize_phone, sync_customer_to_lands
from .parcel_links import auto_parcel_query_url, neighborhood_templates
from .tkgm_sync import TKGM_FIELDS
from .models import CANCEL_DETAIL_CHOICES, CANCEL_DETAILS_BY_REASON, CANCEL_REASON_CHOICES, Customer, CustomerLandRecord, Land, LandStatusHistory


def clear_reservation_when_available(attrs):
    if attrs.get('status') == 'BOS':
        attrs.update({
            'reservation_date': None,
            'customer_name': '',
            'customer_phone': '',
            'deposit_amount': None,
        })
    return attrs


# Türkiye'nin yaklaşık sınırları; enlem/boylamın yer değiştirmesi gibi hataları yakalar.
TURKEY_LATITUDE = (35.5, 42.5)
TURKEY_LONGITUDE = (25.5, 45.0)


def validate_location(attrs, instance):
    latitude = attrs.get('latitude', instance.latitude if instance is not None else None)
    longitude = attrs.get('longitude', instance.longitude if instance is not None else None)
    if (latitude is None) != (longitude is None):
        raise serializers.ValidationError({'latitude': 'Enlem ve boylam birlikte girilmelidir.'})
    if latitude is not None and not (
        TURKEY_LATITUDE[0] <= latitude <= TURKEY_LATITUDE[1] and TURKEY_LONGITUDE[0] <= longitude <= TURKEY_LONGITUDE[1]
    ):
        raise serializers.ValidationError({
            'latitude': 'Koordinat Türkiye sınırları dışında. Enlem ile boylamın yerini kontrol edin (ör. 39.92, 32.85).'
        })
    url = attrs.get('parcel_query_url')
    if url:
        host = urlparse(url).hostname or ''
        if host != 'tkgm.gov.tr' and not host.endswith('.tkgm.gov.tr'):
            raise serializers.ValidationError({'parcel_query_url': 'Link, Tapu ve Kadastro (tkgm.gov.tr) adresinden olmalıdır.'})


def validate_cancel_reason(attrs, instance):
    """Müşterisi olan bir arsa boşa alınırken iptal nedeni zorunludur; diğer durumlarda alanlar yok sayılır."""
    releasing = attrs.get('status') == 'BOS' and instance is not None and instance.status != 'BOS'
    if not releasing:
        for field in ('cancel_reason', 'cancel_detail', 'cancel_note'):
            attrs.pop(field, None)
        return
    reason = attrs.get('cancel_reason', '')
    detail = attrs.get('cancel_detail', '')
    if not reason and instance.customer_records.filter(outcome='active').exists():
        raise serializers.ValidationError({'cancel_reason': 'Arsa boşa alınırken iptal nedeni seçilmelidir.'})
    allowed_details = CANCEL_DETAILS_BY_REASON.get(reason, [])
    if allowed_details and not detail:
        raise serializers.ValidationError({'cancel_detail': 'Bu iptal nedeni için alt seçim yapılmalıdır.'})
    if detail and detail not in allowed_details:
        raise serializers.ValidationError({'cancel_detail': 'Alt seçim, seçilen iptal nedenine ait değil.'})
    if reason == 'diger' and not attrs.get('cancel_note', '').strip():
        raise serializers.ValidationError({'cancel_note': '"Diğer" seçildiğinde kısa bir açıklama yazın.'})


class CancelReasonFields(serializers.Serializer):
    # Modelde olmayan, yalnızca boşa alırken gönderilen alanlar; görünümde ayıklanır.
    cancel_reason = serializers.ChoiceField(choices=CANCEL_REASON_CHOICES, required=False, allow_blank=True, write_only=True)
    cancel_detail = serializers.ChoiceField(choices=CANCEL_DETAIL_CHOICES, required=False, allow_blank=True, write_only=True)
    cancel_note = serializers.CharField(required=False, allow_blank=True, max_length=1000, write_only=True)


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


class AutoParcelLinkField(serializers.Field):
    """Arsanın kendi Parsel Sorgu linki yoksa, aynı mahalleden öğrenilmiş kalıpla üretilen link."""

    def __init__(self, **kwargs):
        super().__init__(source='*', read_only=True, **kwargs)

    def to_representation(self, land):
        templates = self.context.get('tkgm_templates')
        if templates is None:
            templates = self.context['tkgm_templates'] = neighborhood_templates()
        return auto_parcel_query_url(land, templates)


class RepresentativeLandSerializer(serializers.ModelSerializer):
    parcel_query_url_auto = AutoParcelLinkField()
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
            'latitude',
            'longitude',
            'parcel_query_url',
            'parcel_query_url_auto',
            *TKGM_FIELDS,
        ]
        read_only_fields = ['latitude', 'longitude', 'parcel_query_url', *TKGM_FIELDS]

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


class LandSerializer(CancelReasonFields, serializers.ModelSerializer):
    status_history = serializers.SerializerMethodField()
    parcel_query_url_auto = AutoParcelLinkField()

    class Meta:
        model = Land
        fields = '__all__'
        # Müşteri bağlantısı ad/telefondan, TKGM alanları "TKGM'den bilgileri getir" ile otomatik dolar.
        read_only_fields = ['customer', *TKGM_FIELDS]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('hide_reservation_details', False):
            for field in ('reservation_date', 'customer', 'customer_name', 'customer_phone', 'reservation_notes'):
                data.pop(field, None)
        return data

    def get_status_history(self, land):
        return LandStatusHistorySerializer(land.status_history.all(), many=True).data

    def validate(self, attrs):
        attrs = clear_reservation_when_available(attrs)
        validate_cancel_reason(attrs, self.instance)
        validate_location(attrs, self.instance)
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


class LandStatusSerializer(CancelReasonFields, serializers.ModelSerializer):
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
            'cancel_reason',
            'cancel_detail',
            'cancel_note',
        ]

    def validate(self, attrs):
        attrs = clear_reservation_when_available(attrs)
        validate_cancel_reason(attrs, self.instance)
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


class CustomerLandRecordSerializer(serializers.ModelSerializer):
    land_status = serializers.CharField(source='land.status', read_only=True, default=None)
    representative_username = serializers.CharField(source='representative.username', read_only=True, default=None)

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if not getattr(getattr(request, 'user', None), 'is_staff', False):
            for field in ('cancel_reason', 'cancel_detail', 'cancel_note'):
                fields.pop(field, None)
        return fields

    class Meta:
        model = CustomerLandRecord
        fields = [
            'id',
            'land',
            'land_label',
            'il',
            'ilce',
            'land_status',
            'highest_status',
            'outcome',
            'deposit_amount',
            'sale_price',
            'representative_username',
            'started_at',
            'ended_at',
            'cancel_reason',
            'cancel_detail',
            'cancel_note',
        ]


class CustomerSerializer(serializers.ModelSerializer):
    """Liste ve kart için müşteri; özet sayılar görünümde hesaplanıp eklenir."""

    purchased_count = serializers.IntegerField(read_only=True, default=0)
    purchased_total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True, default=None)
    active_count = serializers.IntegerField(read_only=True, default=0)
    cancelled_count = serializers.IntegerField(read_only=True, default=0)
    last_activity_at = serializers.DateTimeField(read_only=True, default=None)
    last_il = serializers.CharField(read_only=True, default='')
    last_ilce = serializers.CharField(read_only=True, default='')
    last_cancel_reason = serializers.CharField(read_only=True, default='')
    last_cancel_detail = serializers.CharField(read_only=True, default='')

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if not getattr(getattr(request, 'user', None), 'is_staff', False):
            fields.pop('last_cancel_reason', None)
            fields.pop('last_cancel_detail', None)
        return fields

    class Meta:
        model = Customer
        fields = [
            'id',
            'full_name',
            'phone',
            'national_id',
            'source',
            'notes',
            'created_at',
            'updated_at',
            'purchased_count',
            'purchased_total',
            'active_count',
            'cancelled_count',
            'last_activity_at',
            'last_il',
            'last_ilce',
            'last_cancel_reason',
            'last_cancel_detail',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Müşteri adı boş olamaz.')
        return value

    def validate_national_id(self, value):
        value = value.strip()
        if value and (not value.isdigit() or len(value) not in (10, 11)):
            raise serializers.ValidationError('TC kimlik no 11, vergi no 10 haneli olmalıdır.')
        return value

    def validate_phone(self, value):
        value = value.strip()
        phone_key = normalize_phone(value)
        if phone_key:
            duplicate = Customer.objects.filter(phone_key=phone_key)
            if self.instance is not None:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            existing = duplicate.first()
            if existing:
                raise serializers.ValidationError(f'Bu telefon numarası zaten "{existing.full_name}" adlı müşteride kayıtlı.')
        return value

    def create(self, validated_data):
        validated_data['phone_key'] = normalize_phone(validated_data.get('phone', ''))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if 'phone' in validated_data:
            validated_data['phone_key'] = normalize_phone(validated_data['phone'])
        customer = super().update(instance, validated_data)
        sync_customer_to_lands(customer)
        return customer


class CustomerDetailSerializer(CustomerSerializer):
    records = CustomerLandRecordSerializer(source='land_records', many=True, read_only=True)

    class Meta(CustomerSerializer.Meta):
        fields = [*CustomerSerializer.Meta.fields, 'records']
