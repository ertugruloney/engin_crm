import json
import math
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import LandCenter

NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
EARTH_RADIUS_KM = 6371.0088


def normalize_place(value):
    value = str(value or '').casefold().replace('ı', 'i')
    value = unicodedata.normalize('NFKD', value)
    return ''.join(character for character in value if not unicodedata.combining(character))


def center_identity(level, il, ilce='', mahalle=''):
    parts = {
        'city': (il,),
        'district': (il, ilce),
        'neighborhood': (il, ilce, mahalle),
    }[level]
    return '|'.join((level, *(normalize_place(part).strip() for part in parts)))


def center_query(level, il, ilce='', mahalle=''):
    parts = {
        'city': (il, 'Türkiye'),
        'district': (ilce, il, 'Türkiye'),
        'neighborhood': (mahalle, ilce, il, 'Türkiye'),
    }[level]
    return ', '.join(part for part in parts if part)


def haversine_km(latitude, longitude, center_latitude, center_longitude):
    lat1, lat2 = math.radians(float(latitude)), math.radians(float(center_latitude))
    delta_lat = lat2 - lat1
    delta_lng = math.radians(float(center_longitude) - float(longitude))
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return round(EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value)), 1)


def land_center_distances(land, context):
    if land.latitude is None or land.longitude is None:
        return {key: None for key in ('city_center_distance_km', 'district_center_distance_km', 'neighborhood_center_distance_km')}

    cache = context.setdefault('land_center_distances', {})
    distances = {}
    levels = (
        ('city', 'city_center_distance_km'),
        ('district', 'district_center_distance_km'),
        ('neighborhood', 'neighborhood_center_distance_km'),
    )
    for level, output_key in levels:
        key = center_identity(level, land.il, land.ilce, land.mahalle)
        if key not in cache:
            cache[key] = LandCenter.objects.filter(cache_key=key).first()
        center = cache[key]
        distances[output_key] = (
            haversine_km(land.latitude, land.longitude, center.latitude, center.longitude)
            if center is not None and center.latitude is not None and center.longitude is not None
            else None
        )
    return distances


def fetch_nominatim_center(query, timeout=15):
    params = urlencode({'q': query, 'format': 'jsonv2', 'limit': 1})
    request = Request(
        f'{NOMINATIM_URL}?{params}',
        headers={'User-Agent': 'EnginCRM/1.0 (land center distance lookup)'},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            results = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise RuntimeError(f'OpenStreetMap merkez bilgisi alınamadı: {error}') from error
    if not results:
        return None
    try:
        latitude = float(results[0]['lat'])
        longitude = float(results[0]['lon'])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError('OpenStreetMap beklenmeyen merkez koordinatı döndürdü.') from error
    if not (35.5 <= latitude <= 42.5 and 25.5 <= longitude <= 45.0):
        raise RuntimeError('OpenStreetMap Türkiye dışında bir merkez koordinatı döndürdü.')
    return latitude, longitude, results[0].get('display_name', '')
