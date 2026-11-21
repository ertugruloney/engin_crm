from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from .audit import record_user_action

from .auth_views import is_call_center
from .customers import land_label
from .listing import ListingError, generate_listing_text
from .models import Land


class IsCallCenter(BasePermission):
    """Yapay zekâ ilan araştırması yalnızca çağrı merkezi rolüne açıktır."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and not request.user.is_staff and is_call_center(request.user)


@api_view(['POST'])
@permission_classes([IsCallCenter])
def generate_land_listing(request, land_id):
    """Çağrı merkezi: arsanın bilgilerinden Claude ile ilan metni üretir ve arsaya kaydeder."""
    land = get_object_or_404(Land, pk=land_id)
    # TKGM bilgisi (alan, nitelik, mevki, konum) yoksa ilandan önce çekilir; bulunamazsa ilan yine yazılır.
    if not land.tkgm_synced_at:
        from . import tkgm
        from .tkgm_sync import ParcelNotFound, sync_land_from_tkgm

        try:
            sync_land_from_tkgm(land)
            land.refresh_from_db()
        except (ParcelNotFound, tkgm.TkgmError):
            pass
    try:
        text = generate_listing_text(land)
    except ListingError as error:
        return Response({'detail': str(error)}, status=status.HTTP_502_BAD_GATEWAY)
    land.listing_text = text
    land.listing_generated_at = timezone.now()
    land.save(update_fields=['listing_text', 'listing_generated_at'])
    record_user_action(request, 'land.listing_generated', 'land', land.pk, {'land_label': land_label(land)})
    return Response({'listing_text': land.listing_text, 'listing_generated_at': land.listing_generated_at})


class ImarDetailSerializer(serializers.Serializer):
    listing_imar_detail = serializers.CharField(max_length=300, allow_blank=True, trim_whitespace=True)


@api_view(['PATCH'])
@permission_classes([IsCallCenter])
def update_listing_imar_detail(request, land_id):
    """Çağrı merkezi: belgeden imar detayını arsaya kaydeder (ilanda imar satırı için kullanılır)."""
    land = get_object_or_404(Land, pk=land_id)
    serializer = ImarDetailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    old = land.listing_imar_detail
    land.listing_imar_detail = serializer.validated_data['listing_imar_detail']
    if old != land.listing_imar_detail:
        land.save(update_fields=['listing_imar_detail'])
        record_user_action(
            request, 'land.updated', 'land', land.pk,
            {'land_label': land_label(land), 'listing_imar_detail': {'old': old, 'new': land.listing_imar_detail}},
        )
    return Response({'listing_imar_detail': land.listing_imar_detail})
