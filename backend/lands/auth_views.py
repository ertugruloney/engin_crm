import json
from datetime import date
from decimal import Decimal

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Count, Max, Q
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAdminUser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework import status
from django.db.models.functions import TruncDate
from django.utils import timezone
from .audit import record_admin_action, record_user_action
from .customers import land_label, sync_land_customer
from .models import AuditLog, Land
from .models import RepresentativeSettings
from .notifications import notify
from .private_files import delete_stored_files
from .serializers import (
    LandDepositSerializer,
    LandReservationSerializer,
    RepresentativeNoteSerializer,
    RepresentativeLandSerializer,
)

VIEWER_GROUP = 'Satış Temsilcisi'
SALES_SUPPORT_GROUP = 'Satış Destek'
LEGACY_VIEWER_GROUP = 'Boş Arsa Görüntüleyici'
# Çağrı merkezi: satış temsilcisiyle aynı ekranı görür ama hiçbir işlem (rezerv, kapora, not) yapamaz.
CALL_CENTER_GROUP = 'Çağrı Merkezi'
APP_ROLE_GROUPS = [VIEWER_GROUP, SALES_SUPPORT_GROUP, LEGACY_VIEWER_GROUP, CALL_CENTER_GROUP]
ROLE_GROUPS = {
    'sales_representative': VIEWER_GROUP,
    'sales_support': SALES_SUPPORT_GROUP,
    'call_center': CALL_CENTER_GROUP,
}


def is_sales_representative(user):
    return user.groups.filter(name__in=APP_ROLE_GROUPS).exists()


def is_call_center(user):
    return user.groups.filter(name=CALL_CENTER_GROUP).exists()


def is_sales_support(user):
    return user.groups.filter(name=SALES_SUPPORT_GROUP).exists()


def user_role(user):
    if user.is_staff:
        return 'admin'
    if is_sales_support(user):
        return 'sales_support'
    if is_call_center(user):
        return 'call_center'
    return 'sales_representative'


class IsSalesRepresentative(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and not request.user.is_staff and is_sales_representative(request.user)


class IsActingSalesRepresentative(IsSalesRepresentative):
    """Temsilci işlemleri (rezerv, kapora, not); çağrı merkezi yalnızca görüntüler."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and not is_call_center(request.user)


class IsAdminOrSalesSupport(BasePermission):
    """Yönetici ve satış destek; satış temsilcileri hariç."""

    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (user.is_staff or is_sales_support(user))


class IsAdminOrSalesRepresentative(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (user.is_staff or is_sales_representative(user))


def user_payload(user):
    return {'id': user.id, 'username': user.get_username(), 'role': user_role(user)}


@ensure_csrf_cookie
@require_GET
def csrf_cookie(request):
    return JsonResponse({'detail': 'CSRF cookie set.'})


@csrf_protect
@require_POST
def login_view(request):
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'detail': 'Geçersiz istek.'}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({'detail': 'Geçersiz istek.'}, status=400)
    username = payload.get('username')
    password = payload.get('password')
    if not isinstance(username, str) or not isinstance(password, str):
        return JsonResponse({'detail': 'Kullanıcı adı ve parola zorunludur.'}, status=400)
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({'detail': 'Kullanıcı adı veya parola hatalı.'}, status=400)
    if not user.is_staff and not is_sales_representative(user):
        return JsonResponse({'detail': 'Bu hesaba bir uygulama rolü atanmamış.'}, status=403)

    login(request, user)
    record_user_action(request, 'auth.login', 'session', user.pk)
    if not user.is_staff:
        notify('user.login', actor=user, related_user=user, target_type='sales_representative', target_id=user.pk)
    return JsonResponse(user_payload(user))


@csrf_protect
@require_POST
def logout_view(request):
    record_user_action(request, 'auth.logout', 'session', request.user.pk if request.user.is_authenticated else '')
    if request.user.is_authenticated and not request.user.is_staff:
        notify('user.logout', actor=request.user, related_user=request.user, target_type='sales_representative', target_id=request.user.pk)
    logout(request)
    return JsonResponse({'detail': 'Oturum kapatıldı.'})


@require_GET
def current_user(request):
    if not request.user.is_authenticated:
        return JsonResponse({'detail': 'Oturum açmanız gerekiyor.'}, status=401)
    if not request.user.is_staff and not is_sales_representative(request.user):
        return JsonResponse({'detail': 'Bu hesaba bir uygulama rolü atanmamış.'}, status=403)
    return JsonResponse(user_payload(request.user))


class ViewerUserCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=8, write_only=True, trim_whitespace=False)
    role = serializers.ChoiceField(
        choices=list(ROLE_GROUPS),
        default='sales_representative',
    )

    def validate_username(self, value):
        from django.contrib.auth import get_user_model

        if get_user_model().objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('Bu kullanıcı adı zaten kullanılıyor.')
        return value

    def validate_password(self, value):
        try:
            validate_password(value)
        except ValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value

    def create(self, validated_data):
        from django.contrib.auth import get_user_model

        role = validated_data['role']
        user_data = {key: value for key, value in validated_data.items() if key != 'role'}
        user = get_user_model().objects.create_user(**user_data)
        group_name = ROLE_GROUPS[role]
        group, _ = Group.objects.get_or_create(name=group_name)
        user.groups.add(group)
        return user


@api_view(['GET', 'POST'])
@permission_classes([IsAdminUser])
def users_view(request):
    from django.contrib.auth import get_user_model

    if request.method == 'GET':
        users = get_user_model().objects.filter(
            groups__name__in=APP_ROLE_GROUPS,
        ).distinct().order_by('username')
        return Response([user_payload(user) for user in users])

    serializer = ViewerUserCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    record_admin_action(
        request,
        'user.created',
        serializer.validated_data['role'],
        user.pk,
        {'username': user.get_username(), 'role': serializer.validated_data['role']},
    )
    notify(
        'user.created',
        actor=request.user,
        related_user=user,
        target_type=serializer.validated_data['role'],
        target_id=user.pk,
        context={'username': user.get_username()},
    )
    return Response(user_payload(user), status=status.HTTP_201_CREATED)


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ['id', 'actor_username', 'action', 'target_type', 'target_id', 'changes', 'created_at']


class AuditLogPagination(PageNumberPagination):
    page_size = 50


def parse_audit_date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def filter_audit_queryset(request):
    """Sorgu parametrelerine göre denetim kaydı sorgusunu filtreler.

    Geçersiz bir tarih gelirse None döner.
    """
    queryset = AuditLog.objects.all()

    actor = request.query_params.get('actor', '').strip()
    action = request.query_params.get('action', '').strip()
    date_from = request.query_params.get('date_from', '').strip()
    date_to = request.query_params.get('date_to', '').strip()

    if actor:
        queryset = queryset.filter(actor_username=actor)
    if action:
        action_list = [item.strip() for item in action.split(',') if item.strip()]
        queryset = queryset.filter(action__in=action_list)
    if date_from:
        parsed = parse_audit_date(date_from)
        if parsed is None:
            return None
        queryset = queryset.filter(created_at__date__gte=parsed)
    if date_to:
        parsed = parse_audit_date(date_to)
        if parsed is None:
            return None
        queryset = queryset.filter(created_at__date__lte=parsed)
    return queryset


@api_view(['GET'])
@permission_classes([IsAdminUser])
def audit_logs(request):
    base_queryset = AuditLog.objects.all()
    queryset = filter_audit_queryset(request)
    if queryset is None:
        return Response({'detail': 'Geçersiz tarih formatı.'}, status=status.HTTP_400_BAD_REQUEST)

    paginator = AuditLogPagination()
    page = paginator.paginate_queryset(queryset, request)
    serializer = AuditLogSerializer(page, many=True)
    response = paginator.get_paginated_response(serializer.data)
    response.data['actors'] = list(
        base_queryset.values_list('actor_username', flat=True)
        .order_by('actor_username')
        .distinct()
    )
    response.data['actions'] = list(
        base_queryset.values_list('action', flat=True)
        .order_by('action')
        .distinct()
    )
    return response


@api_view(['GET'])
@permission_classes([IsAdminOrSalesSupport])
def land_history(request, land_id):
    """Arsanın işlem geçmişi; satış temsilcileri göremez."""
    land = get_object_or_404(Land, pk=land_id)
    queryset = AuditLog.objects.filter(
        target_type='land',
        target_id=str(land.pk),
        action__startswith='land.',
    ).order_by('-created_at', '-id')
    results = AuditLogSerializer(queryset, many=True).data

    if not request.user.is_staff and not representative_reservation_details_visible(request.user):
        private_fields = {
            'reservation_date',
            'customer_name',
            'customer_phone',
            'reservation_notes',
            'deposit_amount',
        }
    else:
        private_fields = set()
    if not request.user.is_staff:
        private_fields.update({'cancel_reason', 'cancel_detail', 'cancel_note'})

    def redact_private_fields(value):
        if isinstance(value, dict):
            return {
                field: redact_private_fields(item)
                for field, item in value.items()
                if field not in private_fields
            }
        if isinstance(value, list):
            return [redact_private_fields(item) for item in value]
        return value

    if private_fields:
        for result in results:
            result['changes'] = redact_private_fields(result['changes'])

    return Response({'results': results})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def audit_log_summary(request):
    """Seçili filtreler için kişi bazlı denetim özeti döndürür."""
    queryset = filter_audit_queryset(request)
    if queryset is None:
        return Response({'detail': 'Geçersiz tarih formatı.'}, status=status.HTTP_400_BAD_REQUEST)

    totals = {
        row['actor_username']: row
        for row in queryset.order_by()
        .values('actor_username')
        .annotate(total=Count('id'), last_at=Max('created_at'))
    }
    action_counts: dict = {}
    for row in queryset.order_by().values('actor_username', 'action').annotate(count=Count('id')):
        action_counts.setdefault(row['actor_username'], {})[row['action']] = row['count']

    users = get_user_model().objects.filter(
        Q(is_staff=True) | Q(groups__name__in=APP_ROLE_GROUPS),
    ).distinct()

    results = []
    for user in users:
        username = user.get_username()
        info = totals.get(username, {})
        results.append({
            'username': username,
            'is_staff': user.is_staff,
            'role': user_role(user),
            'total': info.get('total', 0),
            'last_at': info.get('last_at'),
            'actions': action_counts.get(username, {}),
        })
    results.sort(key=lambda item: (-item['total'], item['username']))
    return Response({'results': results})


def parse_date_range(request):
    """?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD; hatalıysa ValueError."""
    date_from_raw = request.query_params.get('date_from', '').strip()
    date_to_raw = request.query_params.get('date_to', '').strip()
    date_from = parse_audit_date(date_from_raw) if date_from_raw else None
    date_to = parse_audit_date(date_to_raw) if date_to_raw else None
    if (date_from_raw and date_from is None) or (date_to_raw and date_to is None):
        raise ValueError('Geçersiz tarih formatı.')
    return date_from, date_to


@api_view(['GET'])
@permission_classes([IsAdminUser])
def sales_leaderboard(request):
    """Tapu'ya geçen satışları arsayı en son rezerve eden kullanıcıya bağlayarak temsilci bazlı satış tablosu döndürür."""
    try:
        date_from, date_to = parse_date_range(request)
    except ValueError as error:
        return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'results': build_sales_leaderboard(date_from, date_to)})


def build_sales_leaderboard(date_from=None, date_to=None):
    """Temsilci bazlı rezerv/kapora/satış sayıları ve satış tutarı (tarih aralığı dahil)."""

    def in_range(moment):
        day = timezone.localtime(moment).date()
        return (date_from is None or day >= date_from) and (date_to is None or day <= date_to)

    rows: dict = {}
    # Kişi raporundaki detay listesi için: kullanıcı -> arsa id -> aralıktaki olay tarihleri.
    land_events: dict = {}

    def row_for(username):
        return rows.setdefault(
            username,
            {'username': username, 'reservations': 0, 'deposits': 0, 'sales': 0, 'amount': Decimal('0')},
        )

    def mark(username, land_id, field, moment):
        events = land_events.setdefault(username, {}).setdefault(
            int(land_id), {'land_id': int(land_id), 'reserved_at': None, 'deposit_at': None, 'sold_at': None},
        )
        events[field] = moment

    reserver_by_land = {}
    reservations = (
        AuditLog.objects.filter(target_type='land', action='land.status_changed', changes__status__new='REZERV')
        .order_by('created_at', 'id')
        .values('actor_username', 'target_id', 'created_at')
    )
    for item in reservations:
        reserver_by_land[item['target_id']] = item['actor_username']
        if in_range(item['created_at']):
            row_for(item['actor_username'])['reservations'] += 1
            if item['target_id'].isdigit():
                mark(item['actor_username'], item['target_id'], 'reserved_at', item['created_at'])

    for land in Land.objects.exclude(status='BOS').prefetch_related('status_history'):
        username = reserver_by_land.get(str(land.pk))
        if not username:
            continue
        history = list(land.status_history.all())
        deposits = [entry for entry in history if entry.status == 'KAPORA_ALINDI']
        if deposits and in_range(deposits[-1].transitioned_at):
            row_for(username)['deposits'] += 1
            mark(username, land.pk, 'deposit_at', deposits[-1].transitioned_at)
        title_deeds = [entry for entry in history if entry.status == 'TAPU']
        if land.status != 'TAPU' or not title_deeds or not in_range(title_deeds[-1].transitioned_at):
            continue
        row = row_for(username)
        row['sales'] += 1
        row['amount'] += land.sale_price or Decimal('0')
        mark(username, land.pk, 'sold_at', title_deeds[-1].transitioned_at)

    results = sorted(rows.values(), key=lambda row: (-row['amount'], -row['sales'], row['username']))
    for row in results:
        row['amount'] = str(row['amount'])
        row['lands'] = sorted(
            land_events.get(row['username'], {}).values(),
            key=lambda item: max(moment for moment in (item['reserved_at'], item['deposit_at'], item['sold_at']) if moment),
            reverse=True,
        )
    return results


@api_view(['GET'])
@permission_classes([IsAdminUser])
def audit_logs_calendar(request):
    """Günlük bazlı denetim kayıtlarını takvim görünümü için gruplar."""
    queryset = filter_audit_queryset(request)
    if queryset is None:
        return Response({'detail': 'Geçersiz tarih formatı.'}, status=status.HTTP_400_BAD_REQUEST)
    queryset = queryset.filter(action__startswith='land.')

    grouped_queryset = (
        queryset.annotate(day=TruncDate('created_at'))
        .order_by('-day', 'created_at')
        .values(
            'day',
            'id',
            'actor_username',
            'action',
            'target_type',
            'target_id',
            'changes',
            'created_at',
        )
    )

    days: dict[str, list] = {}
    for row in grouped_queryset:
        day_key = row['day'].isoformat() if row['day'] else None
        if not day_key:
            continue
        days.setdefault(day_key, []).append(
            {
                'id': str(row['id']),
                'actor_username': row['actor_username'],
                'action': row['action'],
                'target_type': row['target_type'],
                'target_id': row['target_id'],
                'changes': row['changes'] or {},
                'created_at': row['created_at'].isoformat(),
            }
        )

    result = [
        {'date': key, 'events': days[key]}
        for key in sorted(days.keys(), reverse=True)
    ]
    return Response({'results': result})


def representative_max_stage():
    """Satış temsilcisinin ilerletebileceği en son aşama (Django yönetim panelinden değiştirilir)."""
    return RepresentativeSettings.objects.filter(pk=1).values_list(
        'representative_max_stage', flat=True,
    ).first() or 'KAPORA_ALINDI'


def representatives_can_take_deposit():
    return representative_max_stage() == 'KAPORA_ALINDI'


def representative_notes_allowed(user=None):
    """Temsilci arsa notlarını görebilir ve not ekleyebilir mi (Django yönetim panelindeki ayar)."""
    if user is not None and user_role(user) == 'sales_support':
        return True
    value = RepresentativeSettings.objects.filter(pk=1).values_list('representatives_can_add_notes', flat=True).first()
    return True if value is None else value


def representative_reservation_details_visible(user=None):
    if user is not None and user_role(user) == 'sales_support':
        return True
    return RepresentativeSettings.objects.filter(pk=1).values_list(
        'sales_representatives_can_view_reservation_details',
        flat=True,
    ).first() or False


@api_view(['GET'])
@permission_classes([IsSalesRepresentative])
def representative_settings(request):
    return Response({
        'can_view_reservation_details': representative_reservation_details_visible(request.user),
        'max_stage': representative_max_stage(),
        'can_add_notes': representative_notes_allowed(request.user),
        'read_only': is_call_center(request.user),
    })


@api_view(['GET'])
@permission_classes([IsSalesRepresentative])
def representative_lands(request):
    lands = Land.objects.all().order_by('il', 'ilce', 'mahalle', 'ada', 'parsel', 'hisse_no')
    serializer = RepresentativeLandSerializer(
        lands,
        many=True,
        context={
            'show_reservation_details': representative_reservation_details_visible(request.user),
            'show_notes': representative_notes_allowed(request.user),
            'request': request,
        },
    )
    return Response(serializer.data)


def _representative_land_response(request, land, status_code=status.HTTP_200_OK):
    return Response(RepresentativeLandSerializer(
        land,
        context={
            'show_reservation_details': representative_reservation_details_visible(request.user),
            'show_notes': representative_notes_allowed(request.user),
            'request': request,
        },
    ).data, status=status_code)


def _reserve_for_representative(request, land, reservation_data):
    """Boş arsayı temsilci adına rezerve eder (kayıt, denetim, bildirim). Kilitli bir arsa ile çağrılmalıdır."""
    serializer = LandReservationSerializer(land, data=reservation_data)
    serializer.is_valid(raise_exception=True)
    land = serializer.save(status='REZERV')
    land.status_history.create(status='REZERV')
    sync_land_customer(land, actor=request.user)
    label = land_label(land)
    record_user_action(
        request,
        'land.status_changed',
        'land',
        land.pk,
        {
            'land_label': label,
            'status': {'old': 'BOS', 'new': 'REZERV'},
            'reservation_date': {'old': None, 'new': land.reservation_date.isoformat()},
            'customer_name': {'old': '', 'new': land.customer_name},
            'customer_phone': {'old': '', 'new': land.customer_phone},
        },
    )
    notify(
        'land.reserved',
        actor=request.user,
        related_user=request.user,
        target_type='land',
        target_id=land.pk,
        context={
            'land_label': label,
            'customer_name': land.customer_name or 'belirtilmeyen müşteri',
            'reservation_date': land.reservation_date.isoformat(),
        },
    )
    return land


@api_view(['POST'])
@parser_classes([JSONParser])
@permission_classes([IsActingSalesRepresentative])
def reserve_land(request, land_id):
    with transaction.atomic():
        land = get_object_or_404(
            Land.objects.select_for_update(),
            pk=land_id,
            status='BOS',
        )
        land = _reserve_for_representative(request, land, request.data)
    return _representative_land_response(request, land)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@permission_classes([IsActingSalesRepresentative])
def take_land_deposit(request, land_id):
    """Temsilci kapora tutarı ve kimlik fotoğraflarıyla rezervdeki arsayı "Kapora Alındı" aşamasına taşır.

    Rezervi kimin yaptığına bakılmaz (satış tablosunda kapora yine rezervi yapana yazılır).
    Boş arsada kapora alınamaz; önce rezerv adımı tamamlanmalıdır.
    """
    if not representatives_can_take_deposit():
        return Response(
            {'detail': 'Satış temsilcileri şu an yalnızca rezerv yapabilir; kapora adımı yönetici ayarıyla kapalı.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    deposit_serializer = LandDepositSerializer(data=request.data)
    deposit_serializer.is_valid(raise_exception=True)
    deposit_amount = deposit_serializer.validated_data['deposit_amount']
    id_front_image = deposit_serializer.validated_data['id_front_image']
    id_back_image = deposit_serializer.validated_data['id_back_image']

    with transaction.atomic():
        land = get_object_or_404(Land.objects.select_for_update(), pk=land_id)
        if land.status == 'BOS':
            return Response(
                {'detail': 'Kapora almadan önce arsayı rezerve etmelisiniz.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if land.status != 'REZERV':
            return Response(
                {'detail': 'Bu arsa kapora aşamasını geçmiş.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        previous_id_images = [image.name for image in (land.id_front_image, land.id_back_image) if image]
        land.status = 'KAPORA_ALINDI'
        land.deposit_amount = deposit_amount
        land.id_front_image = id_front_image
        land.id_back_image = id_back_image
        land.save(update_fields=['status', 'deposit_amount', 'id_front_image', 'id_back_image'])
        transaction.on_commit(lambda: delete_stored_files(previous_id_images))
        land.status_history.create(status='KAPORA_ALINDI')
        sync_land_customer(land, actor=request.user)
        label = land_label(land)
        record_user_action(
            request,
            'land.status_changed',
            'land',
            land.pk,
            {
                'land_label': label,
                'status': {'old': 'REZERV', 'new': 'KAPORA_ALINDI'},
                'deposit_amount': {'old': None, 'new': str(deposit_amount)},
                'id_images': {'old': None, 'new': 'Kimlik ön ve arka yüz fotoğrafı yüklendi'},
            },
        )
        notify(
            'land.deposit_taken',
            actor=request.user,
            related_user=request.user,
            target_type='land',
            target_id=land.pk,
            context={
                'land_label': label,
                'customer_name': land.customer_name or 'belirtilmeyen müşteri',
                'deposit_amount': f'{deposit_amount:,.2f} TL'.replace(',', 'X').replace('.', ',').replace('X', '.'),
            },
        )
    return _representative_land_response(request, land)


@api_view(['POST'])
@parser_classes([JSONParser])
@permission_classes([IsActingSalesRepresentative])
def add_representative_land_note(request, land_id):
    """Temsilci arsaya not ekler; not tarih, saat ve kullanıcı adıyla mevcut notların sonuna yazılır."""
    if not representative_notes_allowed(request.user):
        return Response(
            {'detail': 'Arsa notları yönetici ayarları nedeniyle satış temsilcilerine kapalıdır.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    serializer = RepresentativeNoteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    note = serializer.validated_data['note']
    with transaction.atomic():
        land = get_object_or_404(Land.objects.select_for_update(), pk=land_id)
        old_notes = land.reservation_notes or ''
        from .report_summary import DISPLAY_TIME_ZONE

        stamp = timezone.localtime(timezone=DISPLAY_TIME_ZONE).strftime('%d.%m.%Y %H:%M')
        entry = f'[{stamp} · {request.user.get_username()}] {note}'
        land.reservation_notes = f'{old_notes.rstrip()}\n\n{entry}' if old_notes.strip() else entry
        land.save(update_fields=['reservation_notes'])
        label = land_label(land)
        record_user_action(
            request,
            'land.updated',
            'land',
            land.pk,
            {
                'land_label': label,
                'reservation_notes': {'old': old_notes, 'new': land.reservation_notes},
            },
        )
        notify(
            'land.notes_updated',
            actor=request.user,
            related_user=request.user,
            target_type='land',
            target_id=land.pk,
            context={'land_label': label, 'note': note if len(note) <= 120 else f'{note[:117]}...'},
        )
    return _representative_land_response(request, land)


@api_view(['POST'])
@parser_classes([JSONParser])
@permission_classes([IsSalesRepresentative])
def representative_tkgm_sync(request, land_id):
    """Temsilci ve çağrı merkezi arsanın Tapu Kadastro (TKGM) bilgilerini getirebilir; başka alan değişmez."""
    from . import tkgm
    from .tkgm_sync import ParcelNotFound, sync_land_from_tkgm

    land = get_object_or_404(Land, pk=land_id)
    mahalle_id = request.data.get('mahalle_id')
    if mahalle_id not in (None, '') and not str(mahalle_id).isdigit():
        return Response({'detail': 'Geçersiz mahalle numarası.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        sync_land_from_tkgm(land, mahalle_id=int(mahalle_id) if mahalle_id not in (None, '') else None)
    except ParcelNotFound as error:
        return Response(
            {'detail': str(error), 'candidates': [{'id': item['id'], 'name': item['text']} for item in error.candidates]},
            status=status.HTTP_404_NOT_FOUND,
        )
    except tkgm.TkgmError as error:
        return Response({'detail': str(error)}, status=status.HTTP_502_BAD_GATEWAY)
    land.refresh_from_db()
    record_user_action(
        request,
        'land.tkgm_synced',
        'land',
        land.pk,
        {
            'land_label': land_label(land),
            'tkgm_mahalle_id': land.tkgm_mahalle_id,
            'parcel_area': str(land.parcel_area) if land.parcel_area is not None else None,
            'parcel_quality': land.parcel_quality,
        },
    )
    return _representative_land_response(request, land)
