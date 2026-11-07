"""Tapu ve Kadastro (TKGM) Parsel Sorgu servisinden il/ilçe/mahalle numaraları ve parsel bilgisi.

Parsel Sorgu sitesinin kullandığı herkese açık servis kullanılır; istekler yalnızca kullanıcı
"TKGM'den bilgileri getir" dediğinde (ya da tkgm_sync komutuyla, aralarda beklenerek) atılır.
"""
import difflib
import json
import unicodedata
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen

API_BASE = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api'
PARCEL_QUERY_LINK = 'https://parselsorgu.tkgm.gov.tr/#ara/idari/{mahalle_id}/{ada}/{parsel}/'
TIMEOUT_SECONDS = 20

# Mahalle adlarından atılan ekler (ör. "Merkez Mah." -> "merkez").
NAME_SUFFIXES = ('mahallesi', 'mahalle', 'mah', 'mh', 'koyu', 'koy')


class TkgmError(Exception):
    """TKGM'ye ulaşılamadı ya da beklenmeyen yanıt geldi."""


def fetch_json(path):
    try:
        with urlopen(f'{API_BASE}/{path}', timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise TkgmError(f'TKGM servisi hata verdi ({error.code}).') from error
    except (URLError, TimeoutError, ValueError) as error:
        raise TkgmError('TKGM servisine ulaşılamadı. Biraz sonra tekrar deneyin.') from error


def _properties(data):
    return [feature.get('properties', {}) for feature in (data or {}).get('features', [])]


@lru_cache(maxsize=1)
def provinces():
    return _properties(fetch_json('idariYapi/ilListe'))


@lru_cache(maxsize=128)
def districts(province_id):
    return _properties(fetch_json(f'idariYapi/ilceListe/{province_id}'))


@lru_cache(maxsize=512)
def neighborhoods(district_id):
    return _properties(fetch_json(f'idariYapi/mahalleListe/{district_id}'))


def parcel(mahalle_id, ada, parsel):
    """Parsel bulunursa GeoJSON Feature; yoksa None."""
    data = fetch_json(f'parsel/{mahalle_id}/{quote(str(ada).strip())}/{quote(str(parsel).strip())}')
    if not data or not data.get('properties'):
        return None
    return data


def normalize_name(value):
    value = str(value or '').replace('İ', 'i').replace('I', 'ı').casefold().replace('ı', 'i')
    value = unicodedata.normalize('NFKD', value)
    value = ''.join(character for character in value if not unicodedata.combining(character))
    words = value.replace('.', ' ').replace('-', ' - ').split()
    while words and words[-1] in NAME_SUFFIXES:
        words.pop()
    return ' '.join(words)


def _find(items, name):
    target = normalize_name(name)
    return next((item for item in items if normalize_name(item['text']) == target), None)


def _base_name(text):
    # "Ahiboz-Imar" -> "ahiboz"
    return normalize_name(text).split(' - imar')[0].strip()


def neighborhood_candidates(il, ilce, mahalle):
    """(ilçe bulunduysa) o ilçenin mahalleleri ve adı eşleşen/benzeyen adaylar, olasılık sırasıyla."""
    province = _find(provinces(), il)
    if province is None:
        raise LookupError(f'TKGM listesinde "{il}" ili bulunamadı.')
    district = _find(districts(province['id']), ilce)
    if district is None:
        raise LookupError(f'TKGM listesinde {il} / "{ilce}" ilçesi bulunamadı.')
    items = neighborhoods(district['id'])
    target = normalize_name(mahalle)
    exact = [item for item in items if _base_name(item['text']) == target]
    # Önce kadastro kaydı, sonra "-İmar" kaydı.
    exact.sort(key=lambda item: ' - imar' in normalize_name(item['text']))
    close_names = difflib.get_close_matches(target, [_base_name(item['text']) for item in items], n=5, cutoff=0.8)
    close = [item for name in close_names for item in items if _base_name(item['text']) == name and item not in exact]
    return items, [*exact, *close]


def parse_area(value):
    """"6.054,18" -> Decimal("6054.18")"""
    try:
        return Decimal(str(value).replace('.', '').replace(',', '.'))
    except (InvalidOperation, TypeError):
        return None


def polygon_points(feature):
    """GeoJSON Polygon'un dış halkası [[boylam, enlem], ...]; çok parçalıysa en büyük parça."""
    geometry = (feature or {}).get('geometry') or {}
    coordinates = geometry.get('coordinates') or []
    if geometry.get('type') == 'MultiPolygon':
        rings = [polygon[0] for polygon in coordinates if polygon]
        return max(rings, key=len) if rings else []
    return coordinates[0] if coordinates else []


def centroid(points):
    unique = points[:-1] if len(points) > 1 and points[0] == points[-1] else points
    if not unique:
        return None
    longitude = sum(point[0] for point in unique) / len(unique)
    latitude = sum(point[1] for point in unique) / len(unique)
    return round(latitude, 6), round(longitude, 6)
