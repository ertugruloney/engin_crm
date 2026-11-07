"""Tapu Kadastro Parsel Sorgu linklerini mahalle bazında öğrenip ada/parsel'e göre üretir.

Parsel Sorgu linkleri ".../#ara/idari/<mahalle no>/<ada>/<parsel>[/...]" biçimindedir. Bir mahalleden
gerçek bir link kaydedildiğinde mahalle numarası ve linkin kalıbı saklanır; aynı mahalledeki diğer
arsaların linki bu kalıpta yalnızca ada ve parsel değiştirilerek üretilir. Dışarıya istek atılmaz.
"""
import re
import unicodedata
from urllib.parse import unquote

from . import tkgm
from .models import TkgmNeighborhood

LINK_PATTERN = re.compile(r'^(?P<prefix>https://parselsorgu\.tkgm\.gov\.tr/#ara/idari/(?P<id>\d+)/)(?P<ada>[^/]+)/(?P<parsel>[^/]+)(?P<rest>(?:/.*)?)$')


def _normalize(value):
    value = unicodedata.normalize('NFKD', str(value or '').casefold().replace('ı', 'i'))
    return ' '.join(''.join(character for character in value if not unicodedata.combining(character)).split())


def neighborhood_key(land):
    return '|'.join(_normalize(getattr(land, field)) for field in ('il', 'ilce', 'mahalle'))


def learn_from_land(land):
    """Arsanın kendi linki kalıba uyuyorsa ve linkteki ada/parsel arsayla eşleşiyorsa mahalle kalıbını saklar."""
    match = LINK_PATTERN.match((land.parcel_query_url or '').strip())
    if not match:
        return None
    if _normalize(unquote(match['ada'])) != _normalize(land.ada) or _normalize(unquote(match['parsel'])) != _normalize(land.parsel):
        return None
    template = f"{match['prefix']}{{ada}}/{{parsel}}{match['rest']}"
    neighborhood, _ = TkgmNeighborhood.objects.update_or_create(
        neighborhood_key=neighborhood_key(land),
        defaults={'tkgm_id': match['id'], 'template': template},
    )
    return neighborhood


def neighborhood_templates():
    """Tüm öğrenilmiş kalıplar (liste görünümlerinde tek sorguyla kullanılır)."""
    return dict(TkgmNeighborhood.objects.values_list('neighborhood_key', 'template'))


def auto_parcel_query_url(land, templates):
    """Arsanın kendi linki yoksa: TKGM'den bulunmuş mahalle numarasıyla ya da mahalle kalıbıyla üretilmiş link."""
    if land.parcel_query_url:
        return ''
    if land.tkgm_mahalle_id:
        return tkgm.PARCEL_QUERY_LINK.format(
            mahalle_id=land.tkgm_mahalle_id, ada=str(land.ada).strip(), parsel=str(land.parsel).strip(),
        )
    template = templates.get(neighborhood_key(land))
    if not template:
        return ''
    return template.replace('{ada}', str(land.ada).strip()).replace('{parsel}', str(land.parsel).strip())
