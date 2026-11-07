"""Yeni arsa formundaki il → ilçe → mahalle seçimleri için TKGM listeleri (sunucu üzerinden, önbellekli)."""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from . import tkgm
from .auth_views import is_sales_support
from .models import Land

# TKGM il adlarını "ı" yerine "i" ile yazabildiği için ekranda doğru yazım gösterilir.
PROVINCE_NAMES = [
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin',
    'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa',
    'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum',
    'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir',
    'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli',
    'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir',
    'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Şırnak', 'Sivas',
    'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
]
PROVINCE_BY_KEY = {tkgm.normalize_name(name): name for name in PROVINCE_NAMES}


class CanCreateLands(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (user.is_staff or is_sales_support(user))


def _known_spellings(field, **filters):
    """Sistemde kayıtlı yazımlar: aynı adın TKGM yazımı yerine bunlar gösterilir (ör. "Gölbaşi" -> "Gölbaşı")."""
    names = Land.objects.filter(**filters).values_list(field, flat=True).distinct()
    return {tkgm.normalize_name(name): name.strip() for name in names if name and name.strip()}


def _respond(items, spellings):
    rows = [
        {'id': item['id'], 'name': spellings.get(tkgm.normalize_name(item['text']), item['text'])}
        for item in items
    ]
    return Response(rows)


def _guard(loader):
    try:
        return loader()
    except tkgm.TkgmError as error:
        return Response({'detail': str(error)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@permission_classes([CanCreateLands])
def tkgm_provinces(request):
    return _guard(lambda: _respond(tkgm.provinces(), PROVINCE_BY_KEY))


@api_view(['GET'])
@permission_classes([CanCreateLands])
def tkgm_districts(request, province_id):
    province = request.query_params.get('il', '')
    return _guard(lambda: _respond(tkgm.districts(province_id), _known_spellings('ilce', il__iexact=province) if province else {}))


@api_view(['GET'])
@permission_classes([CanCreateLands])
def tkgm_neighborhoods(request, district_id):
    district = request.query_params.get('ilce', '')
    return _guard(lambda: _respond(tkgm.neighborhoods(district_id), _known_spellings('mahalle', ilce__iexact=district) if district else {}))
