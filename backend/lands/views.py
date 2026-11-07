import unicodedata

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import BasePermission, SAFE_METHODS
from django.db import transaction
from .audit import model_snapshot, record_admin_action, record_user_action
from .customers import sync_land_customer
from .parcel_links import learn_from_land
from . import tkgm
from .tkgm_sync import LOCATION_IDENTITY_FIELDS, ParcelNotFound, clear_tkgm_fields, sync_land_from_tkgm
from .models import Land, LandStatusHistory, cancel_reason_text
from .serializers import LandSerializer, LandStatusSerializer
from .auth_views import is_sales_representative, is_sales_support, representative_reservation_details_visible


def normalized_land_key(values):
    def normalize(value):
        value = unicodedata.normalize('NFKD', str(value).casefold().replace('ı', 'i'))
        return ' '.join(''.join(
            character for character in value
            if not unicodedata.combining(character)
        ).split())

    get_value = values.get if isinstance(values, dict) else lambda field: getattr(values, field)
    return tuple(normalize(get_value(field)) for field in ('il', 'ilce', 'mahalle', 'ada', 'parsel'))


class LandRolePermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_staff:
            return True
        if is_sales_support(user):
            return request.method in SAFE_METHODS or request.method in {'POST', 'PUT', 'PATCH'}
        return (
            is_sales_representative(user)
            and request.method in SAFE_METHODS
        )

class LandViewSet(viewsets.ModelViewSet):
    queryset = Land.objects.prefetch_related('status_history')
    serializer_class = LandSerializer
    permission_classes = [LandRolePermission]

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_staff and not is_sales_support(self.request.user):
            return queryset.filter(status='BOS')
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if not self.request.user.is_staff:
            context['hide_reservation_details'] = not representative_reservation_details_visible(self.request.user)
        return context

    def perform_create(self, serializer):
        land = serializer.save()
        land.status_history.create(status=land.status)
        sync_land_customer(land, actor=self.request.user)
        learn_from_land(land)
        self.record_land_action(
            self.request,
            'land.created',
            'land',
            land.pk,
            {
                'land_label': f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}',
                'created': model_snapshot(land),
            },
        )

    def perform_update(self, serializer):
        # İptal nedeni modelde değil müşteri-arsa kaydında tutulur; kaydetmeden önce ayıklanır.
        cancel_reason = serializer.validated_data.pop('cancel_reason', '')
        cancel_detail = serializer.validated_data.pop('cancel_detail', '')
        cancel_note = serializer.validated_data.pop('cancel_note', '').strip()
        previous = model_snapshot(serializer.instance)
        previous_status = serializer.instance.status
        land = serializer.save()
        current = model_snapshot(land)
        changes = {
            field: {'old': previous.get(field), 'new': current.get(field)}
            for field in current
            if previous.get(field) != current.get(field)
        }
        if changes:
            if land.status == 'BOS' and cancel_reason:
                changes['cancel_reason'] = {'old': None, 'new': cancel_reason_text(cancel_reason, cancel_detail)}
                if cancel_note:
                    changes['cancel_note'] = {'old': None, 'new': cancel_note}
            changes['land_label'] = (
                f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}'
            )
            self.record_land_action(
                self.request,
                'land.status_changed' if land.status != previous_status else 'land.updated',
                'land',
                land.pk,
                changes,
            )
        learn_from_land(land)
        if land.tkgm_synced_at and any(field in changes for field in LOCATION_IDENTITY_FIELDS):
            clear_tkgm_fields(land)
        sync_land_customer(
            land,
            actor=self.request.user,
            cancel_reason=cancel_reason,
            cancel_detail=cancel_detail,
            cancel_note=cancel_note,
        )
        if land.status == previous_status:
            return
        if land.status == 'BOS':
            land.status_history.all().delete()
        land.status_history.create(status=land.status)

    def record_land_action(self, request, action, target_type, target_id='', changes=None):
        if is_sales_support(request.user):
            record_user_action(request, action, target_type, target_id, changes)
        else:
            record_admin_action(request, action, target_type, target_id, changes)

    @action(detail=True, methods=['post'], url_path='tkgm-sync')
    def tkgm_sync(self, request, pk=None):
        """Arsayı TKGM Parsel Sorgu'da bulur; mahalle numarası, parsel bilgileri, sınır ve koordinatı kaydeder."""
        land = self.get_object()
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
        self.record_land_action(
            request,
            'land.tkgm_synced',
            'land',
            land.pk,
            {
                'land_label': f'{land.il}, {land.ilce}, {land.mahalle}, Ada {land.ada} / Parsel {land.parsel}',
                'tkgm_mahalle_id': land.tkgm_mahalle_id,
                'parcel_area': str(land.parcel_area) if land.parcel_area is not None else None,
                'parcel_quality': land.parcel_quality,
            },
        )
        land.refresh_from_db()
        return Response(self.get_serializer(land).data)

    @action(detail=True, methods=['patch'], url_path='change-status')
    def change_status(self, request, pk=None):
        land = self.get_object()
        serializer = LandStatusSerializer(land, data=request.data, partial=True)
        if serializer.is_valid():
            self.perform_update(serializer)
            return Response(self.get_serializer(land).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='bulk-create')
    def bulk_create(self, request):
        serializer = LandSerializer(data=request.data, many=True)
        if serializer.is_valid():
            with transaction.atomic():
                existing_keys = {
                    normalized_land_key(land)
                    for land in Land.objects.only('il', 'ilce', 'mahalle', 'ada', 'parsel')
                }
                seen_keys = set(existing_keys)
                duplicate_rows = []
                for index, values in enumerate(serializer.validated_data, start=2):
                    key = normalized_land_key(values)
                    if key in seen_keys:
                        duplicate_rows.append(index)
                    else:
                        seen_keys.add(key)
                if duplicate_rows:
                    return Response({
                        'detail': 'Excel dosyasında veya sistemde zaten bulunan arsalar aktarılmadı. Yinelenen satırları kaldırıp tekrar deneyin.',
                        'duplicate_rows': duplicate_rows,
                    }, status=status.HTTP_400_BAD_REQUEST)
                lands = serializer.save()
                for land in lands:
                    learn_from_land(land)
                LandStatusHistory.objects.bulk_create([
                    LandStatusHistory(land=land, status=land.status)
                    for land in lands
                ])
                self.record_land_action(
                    request,
                    'land.bulk_created',
                    'land',
                    '',
                    {
                        'count': len(lands),
                        'land_label': f'{len(lands)} arsa',
                        'lands': [model_snapshot(land) for land in lands],
                    },
                )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def perform_destroy(self, instance):
        with transaction.atomic():
            record_admin_action(
                self.request,
                'land.deleted',
                'land',
                instance.pk,
                {
                    'land_label': f'{instance.il}, {instance.ilce}, {instance.mahalle}, Ada {instance.ada} / Parsel {instance.parsel}',
                    'deleted': model_snapshot(instance),
                },
            )
            instance.delete()
