from django.db import models
from django.conf import settings
from django.utils import timezone


class Customer(models.Model):
    """Arsalardan bağımsız müşteri kartı; arsa boşa alınsa da müşteri ve geçmişi kalır."""

    SOURCE_CHOICES = [
        ('referans', 'Referans'),
        ('ilan', 'İlan sitesi'),
        ('sosyal_medya', 'Sosyal medya'),
        ('web', 'Web sitesi'),
        ('ofis', 'Ofis ziyareti / tabela'),
        ('telefon', 'Telefon'),
        ('diger', 'Diğer'),
    ]

    full_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=30, blank=True, default='')
    # Eşleştirme için yalnızca rakamlar (ör. 905321234567); aynı numaralı kişi tek müşteri sayılır.
    phone_key = models.CharField(max_length=20, blank=True, default='', db_index=True)
    national_id = models.CharField(max_length=11, blank=True, default='')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['full_name', 'id']

    def __str__(self):
        return self.full_name


class Land(models.Model):
    STATUS_CHOICES = [
        ('BOS', 'Available'),
        ('REZERV', 'Reserved'),
        ('KAPORA_ALINDI', 'Deposit Paid'),
        ('TAPU', 'Title Deed'),
    ]

    il = models.CharField(max_length=100)
    ilce = models.CharField(max_length=100)
    mahalle = models.CharField(max_length=100)
    ada = models.CharField(max_length=100)
    parsel = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='BOS')
    is_reserved = models.BooleanField(default=False)
    reservation_notes = models.TextField(blank=True, null=True)
    reservation_date = models.DateField(blank=True, null=True)
    customer = models.ForeignKey(
        Customer,
        related_name='lands',
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    # Ekranlarda kullanılan anlık kopya; müşteri kartıyla eşitlenir.
    customer_name = models.CharField(max_length=200, blank=True, default='')
    customer_phone = models.CharField(max_length=30, blank=True, default='')
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    sale_price = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    installment_plan = models.JSONField(default=list, blank=True)
    title_deed_image = models.ImageField(upload_to='title_deed_images/', blank=True, null=True)
    # Konum: satışçının müşteriye doğru yeri göstermesi için (isteğe bağlı).
    latitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    parcel_query_url = models.URLField(max_length=500, blank=True, default='')
    # TKGM Parsel Sorgu'dan alınan bilgiler (bkz. tkgm_sync.sync_land_from_tkgm).
    tkgm_mahalle_id = models.PositiveIntegerField(blank=True, null=True)
    parcel_area = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    parcel_quality = models.CharField(max_length=150, blank=True, default='')
    parcel_locality = models.CharField(max_length=150, blank=True, default='')
    parcel_sheet = models.CharField(max_length=60, blank=True, default='')
    parcel_geometry = models.JSONField(blank=True, null=True)
    tkgm_synced_at = models.DateTimeField(blank=True, null=True)

    def __str__(self):
        return f"{self.il} - {self.ilce} - Ada: {self.ada} Parsel: {self.parsel}"


# İptal nedenleri: (ana neden kodu, adı, alt nedenler). Alt nedeni olan ana nedende alt seçim zorunludur.
CANCEL_REASON_TREE = [
    ('fiyat_odeme', 'Fiyat / ödeme sorunu', [
        ('odeme_karsilanamadi', 'Ödeme karşılanamadı'),
        ('kredi_cikmadi', 'Kredi çıkmadı'),
        ('fiyat_anlasilamadi', 'Fiyatta anlaşılamadı'),
        ('taksit_anlasilamadi', 'Taksitte anlaşılamadı'),
    ]),
    ('baska_arsa', 'Başka bir arsayı tercih etti', [
        ('bizden_aldi', 'Bizden başka arsa aldı'),
        ('rakipten_aldi', 'Rakipten aldı'),
    ]),
    ('ozellik', 'Arsanın özelliği uymadı', [
        ('imar', 'İmar durumu'),
        ('yol_cephe', 'Yol / cephe'),
        ('hisseli', 'Hisseli tapu'),
    ]),
    ('yerinde_gordu', 'Arsayı yerinde görünce vazgeçti', []),
    ('yanlis_yer', 'Satışçı yanlış yeri göstermiş', []),
    ('ulasilamiyor', 'Müşteriye ulaşılamıyor / vazgeçti', [
        ('donus_yok', 'Dönüş yapmıyor'),
        ('sure_doldu', 'Rezerv süresi doldu'),
        ('kisisel', 'Kişisel nedenler'),
    ]),
    ('diger', 'Diğer', []),
    # Arsa başka bir müşteriye geçtiğinde sistem tarafından verilir.
    ('devredildi', 'Arsa başka müşteriye verildi', []),
]
CANCEL_REASON_CHOICES = [(code, label) for code, label, _ in CANCEL_REASON_TREE]
CANCEL_DETAIL_CHOICES = [(code, label) for _, _, details in CANCEL_REASON_TREE for code, label in details]
CANCEL_REASON_LABELS = dict(CANCEL_REASON_CHOICES)
CANCEL_DETAIL_LABELS = dict(CANCEL_DETAIL_CHOICES)
CANCEL_DETAILS_BY_REASON = {code: [detail for detail, _ in details] for code, _, details in CANCEL_REASON_TREE}


def cancel_reason_text(reason, detail=''):
    """Ör. "Fiyat / ödeme sorunu – Kredi çıkmadı"."""
    label = CANCEL_REASON_LABELS.get(reason, reason)
    return f'{label} – {CANCEL_DETAIL_LABELS[detail]}' if detail in CANCEL_DETAIL_LABELS else label


class CustomerLandRecord(models.Model):
    """Müşterinin bir arsayla ilişkisinin kalıcı kaydı (rezervasyondan satışa ya da iptale)."""

    OUTCOME_CHOICES = [
        ('active', 'Devam ediyor'),
        ('sold', 'Satın aldı'),
        ('cancelled', 'İptal edildi'),
    ]

    customer = models.ForeignKey(Customer, related_name='land_records', on_delete=models.CASCADE)
    land = models.ForeignKey(
        Land,
        related_name='customer_records',
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    # Arsa silinse ya da başkasına geçse de kayıt okunabilsin diye anlık kopyalar.
    land_label = models.CharField(max_length=400)
    il = models.CharField(max_length=100, blank=True, default='')
    ilce = models.CharField(max_length=100, blank=True, default='')
    highest_status = models.CharField(max_length=20, choices=Land.STATUS_CHOICES, default='REZERV')
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES, default='active')
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    sale_price = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    representative = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='customer_land_records',
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(blank=True, null=True)
    cancel_reason = models.CharField(max_length=20, choices=CANCEL_REASON_CHOICES, blank=True, default='')
    cancel_detail = models.CharField(max_length=30, choices=CANCEL_DETAIL_CHOICES, blank=True, default='')
    cancel_note = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-started_at', '-id']


class LandStatusHistory(models.Model):
    land = models.ForeignKey(Land, related_name='status_history', on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=Land.STATUS_CHOICES)
    transitioned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['transitioned_at', 'id']


class AuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='audit_logs',
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    actor_username = models.CharField(max_length=150)
    action = models.CharField(max_length=50)
    target_type = models.CharField(max_length=100)
    target_id = models.CharField(max_length=100, blank=True)
    changes = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']


class RepresentativeSettings(models.Model):
    sales_representatives_can_view_reservation_details = models.BooleanField(
        default=False,
        verbose_name='Satış temsilcileri rezervasyon detaylarını görebilsin',
        help_text='Kapalıyken müşteri bilgileri ve arsa notları satış temsilcilerine gösterilmez.',
    )

    class Meta:
        verbose_name = 'Satış temsilcisi görünürlük ayarı'
        verbose_name_plural = 'Satış temsilcisi görünürlük ayarları'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return 'Satış temsilcisi görünürlük ayarı'


class NotificationSettings(models.Model):
    disabled_codes = models.JSONField(
        default=list,
        blank=True,
        help_text='Kapalı bildirim kodlarının listesi. listede olmayan kodlar açıktır.',
    )

    class Meta:
        verbose_name = 'Bildirim ayarı'
        verbose_name_plural = 'Bildirim ayarları'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return 'Bildirim ayarları'


class Notification(models.Model):
    code = models.CharField(max_length=50, db_index=True)
    title = models.CharField(max_length=200)
    message = models.TextField()
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='authored_notifications',
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
    )
    actor_username = models.CharField(max_length=150, blank=True, default='')
    related_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='related_notifications',
        blank=True,
        null=True,
        on_delete=models.CASCADE,
    )
    related_username = models.CharField(max_length=150, blank=True, default='')
    target_type = models.CharField(max_length=100, blank=True, default='')
    target_id = models.CharField(max_length=100, blank=True, default='')
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'[{self.code}] {self.title}'


class TkgmNeighborhood(models.Model):
    """Bir mahallenin Parsel Sorgu link kalıbı; o mahalleden kaydedilen gerçek bir linkten öğrenilir.

    template içinde {ada} ve {parsel} yer tutucuları bulunur; aynı mahalledeki diğer arsaların linki bundan üretilir.
    """

    neighborhood_key = models.CharField(max_length=320, unique=True)
    tkgm_id = models.CharField(max_length=20)
    template = models.CharField(max_length=500)
    updated_at = models.DateTimeField(auto_now=True)
