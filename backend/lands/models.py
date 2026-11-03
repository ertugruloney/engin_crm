from django.db import models
from django.conf import settings

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
    customer_name = models.CharField(max_length=200, blank=True, default='')
    customer_phone = models.CharField(max_length=30, blank=True, default='')
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    sale_price = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    installment_plan = models.JSONField(default=list, blank=True)
    title_deed_image = models.ImageField(upload_to='title_deed_images/', blank=True, null=True)

    def __str__(self):
        return f"{self.il} - {self.ilce} - Ada: {self.ada} Parsel: {self.parsel}"


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
