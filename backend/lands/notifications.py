from .models import Notification, NotificationSettings

STATUS_LABELS = {
    'BOS': 'Satışa Uygun',
    'REZERV': 'Rezerv',
    'KAPORA_ALINDI': 'Kapora Alındı',
    'TAPU': 'Tapu',
}

NOTIFICATION_DEFINITIONS = [
    {
        'code': 'user.created',
        'label': 'Satış temsilcisi oluşturuldu',
        'description': 'Yeni bir satış temsilcisi hesabı oluşturulduğunda yöneticiye bildirim gönderir.',
        'title': 'Yeni satış temsilcisi',
        'message': '{actor_username}, "{username}" satış temsilcisi hesabını oluşturdu.',
    },
    {
        'code': 'user.login',
        'label': 'Temsilci oturum açtı',
        'description': 'Bir satış temsilcisi sisteme giriş yaptığında yöneticiye bildirim gönderir.',
        'title': 'Temsilci giriş yaptı',
        'message': '{actor_username} satış temsilcisi olarak sisteme giriş yaptı.',
    },
    {
        'code': 'user.logout',
        'label': 'Temsilci oturum kapattı',
        'description': 'Bir satış temsilcisi oturumunu kapattığında yöneticiye bildirim gönderir.',
        'title': 'Temsilci çıkış yaptı',
        'message': '{actor_username} oturumunu kapattı.',
    },
    {
        'code': 'land.reserved',
        'label': 'Arsa rezerve edildi',
        'description': 'Bir satış temsilcisi boş bir arsayı rezerve ettiğinde yöneticiye bildirim gönderir.',
        'title': 'Yeni rezervasyon',
        'message': '{actor_username}, {land_label} arsasını {customer_name} için rezerve etti.',
    },
    {
        'code': 'land.notes_updated',
        'label': 'Arsa notu güncellendi',
        'description': 'Bir satış temsilcisi arsa notunu güncellediğinde yöneticiye bildirim gönderir.',
        'title': 'Arsa notu güncellendi',
        'message': '{actor_username}, {land_label} arsasının notunu güncelledi.',
    },
    {
        'code': 'settings.updated',
        'label': 'Temsilci ayarı değişti',
        'description': 'Satış temsilcisi görünürlük ayarı değiştirildiğinde yöneticiye bildirim gönderir.',
        'title': 'Temsilci ayarı değişti',
        'message': 'Rezervasyon detay görünürlüğü {old_value} → {new_value} olarak değiştirildi.',
    },
]

NOTIFICATION_DEFINITIONS_BY_CODE = {item['code']: item for item in NOTIFICATION_DEFINITIONS}

ALL_NOTIFICATION_CODES = list(NOTIFICATION_DEFINITIONS_BY_CODE)


class _SafeFormat(dict):
    def __missing__(self, key):
        return ''


def notification_settings():
    settings, _ = NotificationSettings.objects.get_or_create(pk=1, defaults={'disabled_codes': []})
    return settings


def disabled_notification_codes():
    return set(notification_settings().disabled_codes or [])


def is_notification_enabled(code):
    return code in NOTIFICATION_DEFINITIONS_BY_CODE and code not in disabled_notification_codes()


def notify(code, *, actor=None, related_user=None, target_type='', target_id='', context=None):
    """Ayarlar üzerinden kapalı olmayan bir bildirim kodu için kayıt oluşturur."""
    definition = NOTIFICATION_DEFINITIONS_BY_CODE.get(code)
    if definition is None or not is_notification_enabled(code):
        return None

    values = _SafeFormat(context or {})
    if actor is not None:
        values.setdefault('actor_username', actor.get_username())
    if related_user is not None:
        values.setdefault('related_username', related_user.get_username())

    return Notification.objects.create(
        code=code,
        title=definition['title'],
        message=definition['message'].format_map(values),
        actor=actor,
        actor_username=values.get('actor_username', '') or '',
        related_user=related_user,
        related_username=values.get('related_username', '') or '',
        target_type=target_type,
        target_id=str(target_id or ''),
    )
