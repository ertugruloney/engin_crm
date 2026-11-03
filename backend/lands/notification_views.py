from django.db.models import Count
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .audit import record_admin_action
from .models import Notification
from .notifications import NOTIFICATION_DEFINITIONS, notification_settings


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            'id',
            'code',
            'title',
            'message',
            'actor_username',
            'related_username',
            'target_type',
            'target_id',
            'is_read',
            'created_at',
        ]


class NotificationPagination(PageNumberPagination):
    page_size = 20


def _filter_user_id(value):
    if value in (None, ''):
        return None
    if not str(value).isdigit():
        return -1
    return int(value)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def notifications_list(request):
    queryset = Notification.objects.all()
    user_id = _filter_user_id(request.query_params.get('user_id'))
    if user_id is not None:
        queryset = queryset.filter(related_user_id=user_id)
    if request.query_params.get('unread') == '1':
        queryset = queryset.filter(is_read=False)

    paginator = NotificationPagination()
    page = paginator.paginate_queryset(queryset, request)
    return paginator.get_paginated_response(NotificationSerializer(page, many=True).data)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def notification_counts(request):
    unread = Notification.objects.filter(is_read=False)
    grouped = (
        unread.exclude(related_user__isnull=True)
        .values('related_user_id')
        .annotate(count=Count('id'))
    )
    by_user = {str(row['related_user_id']): row['count'] for row in grouped}
    return Response({'total': unread.count(), 'by_user': by_user})


@api_view(['POST'])
@permission_classes([IsAdminUser])
def notification_read(request, pk):
    notification = Notification.objects.filter(pk=pk).first()
    if notification is None:
        return Response({'detail': 'Bildirim bulunamadı.'}, status=status.HTTP_404_NOT_FOUND)
    if not notification.is_read:
        notification.is_read = True
        notification.save(update_fields=['is_read'])
    return Response(NotificationSerializer(notification).data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def notifications_read_all(request):
    queryset = Notification.objects.filter(is_read=False)
    user_id = _filter_user_id(request.data.get('user_id'))
    if user_id is not None:
        queryset = queryset.filter(related_user_id=user_id)
    updated = queryset.update(is_read=True)
    return Response({'updated': updated})


class NotificationSettingsSerializer(serializers.Serializer):
    settings = serializers.ListField(child=serializers.DictField(), write_only=True, required=False)
    disabled_codes = serializers.ListField(child=serializers.CharField(), required=False)

    def validate_settings(self, value):
        known_codes = {item['code'] for item in NOTIFICATION_DEFINITIONS}
        for entry in value:
            if entry.get('code') not in known_codes:
                raise serializers.ValidationError(f"Bilinmeyen bildirim kodu: {entry.get('code')}")
        return value


def notification_settings_payload():
    disabled = set(notification_settings().disabled_codes or [])
    return [
        {
            'code': item['code'],
            'label': item['label'],
            'description': item['description'],
            'title': item['title'],
            'enabled': item['code'] not in disabled,
        }
        for item in NOTIFICATION_DEFINITIONS
    ]


@api_view(['GET', 'PUT'])
@permission_classes([IsAdminUser])
def notification_settings_view(request):
    if request.method == 'GET':
        return Response({'settings': notification_settings_payload()})

    serializer = NotificationSettingsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    known_codes = {item['code'] for item in NOTIFICATION_DEFINITIONS}
    if 'disabled_codes' in serializer.validated_data:
        disabled = sorted(set(serializer.validated_data['disabled_codes']) & known_codes)
    else:
        disabled = sorted({
            entry['code']
            for entry in serializer.validated_data.get('settings', [])
            if not entry.get('enabled', True)
        })

    settings = notification_settings()
    previous = sorted(settings.disabled_codes or [])
    if previous != disabled:
        settings.disabled_codes = disabled
        settings.save(update_fields=['disabled_codes'])
        record_admin_action(
            request,
            'notification_settings.updated',
            'notification_settings',
            settings.pk,
            {'disabled_codes': {'old': previous, 'new': disabled}},
        )
    return Response({'settings': notification_settings_payload()})
