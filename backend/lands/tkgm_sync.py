"""Bir arsanın TKGM karşılığını bulup arsaya işler: mahalle numarası, parsel bilgileri, sınır ve koordinat."""
from decimal import Decimal

from django.utils import timezone

from . import tkgm

TKGM_FIELDS = [
    'tkgm_mahalle_id',
    'parcel_area',
    'parcel_quality',
    'parcel_locality',
    'parcel_sheet',
    'parcel_geometry',
    'tkgm_synced_at',
]
LOCATION_IDENTITY_FIELDS = ('il', 'ilce', 'mahalle', 'ada', 'parsel')


class ParcelNotFound(Exception):
    """Parsel TKGM'de bulunamadı; candidates seçilebilecek mahalleleri içerir."""

    def __init__(self, message, candidates=()):
        super().__init__(message)
        self.candidates = list(candidates)


def sync_land_from_tkgm(land, mahalle_id=None):
    """Arsayı TKGM'de bulur ve bilgileri kaydeder. Bulunamazsa ParcelNotFound, servis hatasında tkgm.TkgmError."""
    if mahalle_id is not None:
        candidates, all_items = [{'id': int(mahalle_id), 'text': ''}], []
    else:
        try:
            all_items, candidates = tkgm.neighborhood_candidates(land.il, land.ilce, land.mahalle)
        except LookupError as error:
            raise ParcelNotFound(str(error)) from error

    for candidate in candidates:
        feature = tkgm.parcel(candidate['id'], land.ada, land.parsel)
        if feature is None:
            continue
        properties = feature['properties']
        points = tkgm.polygon_points(feature)
        land.tkgm_mahalle_id = int(properties.get('mahalleId') or candidate['id'])
        land.parcel_area = tkgm.parse_area(properties.get('alan'))
        land.parcel_quality = (properties.get('nitelik') or '')[:150]
        land.parcel_locality = (properties.get('mevkii') or '')[:150]
        land.parcel_sheet = (properties.get('pafta') or '')[:60]
        land.parcel_geometry = points or None
        land.tkgm_synced_at = timezone.now()
        update_fields = list(TKGM_FIELDS)
        # TKGM listeleri "ı" yerine "i" yazabildiği için parsel yanıtındaki resmi yazım kullanılır;
        # yalnızca yazım farkı varsa (ör. "Gölbaşi" -> "Gölbaşı"), başka bir ada asla geçilmez.
        for field, key in (('il', 'ilAd'), ('ilce', 'ilceAd'), ('mahalle', 'mahalleAd')):
            official = (properties.get(key) or '').strip()
            current = getattr(land, field)
            if official and official != current and tkgm.normalize_name(official) == tkgm.normalize_name(current):
                setattr(land, field, official)
                update_fields.append(field)
        center = tkgm.centroid(points)
        if center and land.latitude is None:
            land.latitude, land.longitude = (Decimal(str(value)) for value in center)
            update_fields += ['latitude', 'longitude']
        land.save(update_fields=update_fields)
        return land

    message = (
        f'{land.ilce} / {land.mahalle} mahallesinde Ada {land.ada} / Parsel {land.parsel} bulunamadı.'
        if candidates
        else f'{land.il} / {land.ilce} ilçesinde "{land.mahalle}" adlı mahalle bulunamadı.'
    )
    # İlçedeki tüm mahalleler, doğrusunun elle seçilebilmesi için döner.
    raise ParcelNotFound(message, all_items)


def clear_tkgm_fields(land):
    """Arsanın il/ilçe/mahalle/ada/parsel bilgisi değişince eski TKGM bilgileri geçersizdir."""
    land.tkgm_mahalle_id = None
    land.parcel_area = None
    land.parcel_quality = ''
    land.parcel_locality = ''
    land.parcel_sheet = ''
    land.parcel_geometry = None
    land.tkgm_synced_at = None
    land.save(update_fields=TKGM_FIELDS)
