"""Arsa kaydındaki bilgilerden Claude ile satış ilanı metni üretir.

Bilgi kaynakları (elle girilen sözlük yerine sistemin kendi servisleri):
- Arsa kaydı: il, ilçe, mahalle, ada/parsel, tapu tipi (müstakil/hisseli)
- TKGM Parsel Sorgu: alan, nitelik (imar çıkarımı buradan), mevki (eksikse ilan öncesi otomatik çekilir, bkz. listing_views)
- Harita (OpenStreetMap): Nominatim ile il/ilçe merkezi, OSRM ile oraya araçla mesafe/süre,
  Overpass ile yakındaki market, okul, sağlık, eczane, cami, lokanta, plaj, göl
- Çağrı merkezinin girdiği imar detayı (boşsa imar TKGM niteliğinden çıkarılır)
Yol, elektrik/su, çevre ve telefon bilgisi ilana hiç konmaz.
Boş bilgiler gönderilmez; Claude o satırları ve tamamen boş kalan bölümleri ilandan çıkarır. Müşteri bilgileri ve fiyat asla gönderilmez.

Anahtar ANTHROPIC_API_KEY ortam değişkeninden okunur (start.sh, backend/.env dosyasını yükler).
"""
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import anthropic

from .center_distances import center_identity, center_query, fetch_nominatim_center, haversine_km
from .models import LandCenter

MODEL = 'claude-sonnet-5-5'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'
USER_AGENT = 'EnginCRM/1.0 (listing map lookup)'
NEARBY_RADIUS_M = 5000
# Web araması turu uzun sürerse API "pause_turn" döner; en fazla bu kadar kez devam ettirilir.
MAX_CONTINUATIONS = 3

SABLON = """🌲🌊 [DİKKAT ÇEKİCİ BAŞLIK – M² VE MAHALLE ADIYLA, BÜYÜK HARF] 🌊🌲
[2 cümlelik, duygulu giriş paragrafı]

📍 Arsa bilgileri
* Konum: [İl / İlçe / Mahalle]
* Ada / Parsel: [ada / parsel]
* Alan: [m²], tapuda [nitelik] vasıflı
* İmar: [imar]
* Tapu: [Müstakil / Hisseli]

🛒 Yakındaki yerler
* [market, okul, ana yol vb. + yaklaşık mesafe]

🚗 Mesafeler
* [yalnızca verilen ya da web aramasıyla doğrulanan mesafeler]

✨ Neden bu arsa?
* [Kısa başlık]: [1 cümle]   (5 madde)

🏡 [Kapanış cümlesi]"""

SISTEM = f"""Sen Türkiye'de çalışan deneyimli bir emlak ilan yazarısın.
Satış odaklı, emojili, kısa ve çekici ilanlar yazarsın.

KURALLAR:
1. Çıktıyı AYNEN şu kalıpta ver, öncesine/sonrasına açıklama ekleme:
{SABLON}
2. Arsaya özel bilgileri (m², nitelik, imar, tapu, yakındaki yerler) SADECE verilen
   verilerden yaz. Asla uydurma. Yol, elektrik/su, altyapı ve çevredeki yapılaşma
   hakkında hiçbir şey yazma (ne satır ne bölüm).
3. Bölge avantajlarını (göl, deniz, tarihi yerler, ulaşım) web aramasıyla
   doğrulayarak yazabilirsin. Emin olmadığın mesafeye "~" koy.
4. Olumsuz şeyleri (fabrika, tesis vb.) ilana yazma ama asla yalan da yazma.
5. Verilen mesafeler haritadan ölçülmüştür (araçla ya da kuş uçuşu, yanında yazar); "~" ile yaz.
6. Bilgisini alamadığın, doğrulayamadığın ya da hakkında yorum yapamadığın her satırı çıktıdan
   TAMAMEN çıkar; köşeli parantezli yer tutucu ([durumu], [Deniz / göl mesafesi], [Havalimanı mesafesi],
   [Telefon] vb.) ASLA yazma. Bir bölümde yazılacak hiç satır kalmazsa bölümü başlığıyla birlikte çıkar.
   Şablondaki köşeli parantezler sadece neyin nereye yazılacağını gösterir, çıktıda köşeli parantez olmamalı."""


def imar_bilgisi(nitelik, imar_detay=''):
    """Belgedeki imar detayı varsa onu, yoksa TKGM'deki tapu niteliğinden çıkarımı döndürür."""
    if imar_detay:
        return imar_detay
    nitelik = (nitelik or '').strip()
    if not nitelik:
        return ''
    if nitelik.casefold() == 'arsa':
        return 'Var (tapuda arsa vasıflı)'
    return f'Yok (tapuda {nitelik.casefold()} vasıflı)'


# Harita (OpenStreetMap) kategorileri: (etiket, Overpass filtresi, etiket kontrolü)
NEARBY_CATEGORIES = [
    ('Market', '["shop"~"^(supermarket|convenience)$"]', lambda t: t.get('shop') in {'supermarket', 'convenience'}),
    ('Okul', '["amenity"="school"]', lambda t: t.get('amenity') == 'school'),
    ('Sağlık', '["amenity"~"^(hospital|clinic|doctors)$"]', lambda t: t.get('amenity') in {'hospital', 'clinic', 'doctors'}),
    ('Eczane', '["amenity"="pharmacy"]', lambda t: t.get('amenity') == 'pharmacy'),
    ('Cami', '["amenity"="place_of_worship"]["religion"="muslim"]',
     lambda t: t.get('amenity') == 'place_of_worship' and t.get('religion') == 'muslim'),
    ('Lokanta', '["amenity"~"^(restaurant|cafe)$"]', lambda t: t.get('amenity') in {'restaurant', 'cafe'}),
    ('Plaj', '["natural"="beach"]', lambda t: t.get('natural') == 'beach'),
    ('Göl / deniz kıyısı', '["natural"="water"]', lambda t: t.get('natural') == 'water'),
]


class ListingError(Exception):
    """Kullanıcıya gösterilecek Türkçe hata mesajı taşır."""


def _format_km(value):
    return f'{value:.1f}'.replace('.', ',') + ' km'


def _format_area(value):
    return f'{value:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.') + ' m²'


def fetch_nearby_places(latitude, longitude, timeout=10):
    """Haritadan her kategori için en yakın adı olan yeri ve kuş uçuşu mesafesini döner. Hata olursa boş liste."""
    around = f'(around:{NEARBY_RADIUS_M},{latitude},{longitude})'
    body = ''.join(f'nwr{selector}["name"]{around};' for _, selector, _ in NEARBY_CATEGORIES)
    query = f'[out:json][timeout:{timeout}];({body});out center tags;'
    request = Request(
        OVERPASS_URL,
        data=urlencode({'data': query}).encode(),
        headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'},
    )
    try:
        with urlopen(request, timeout=timeout + 2) as response:
            elements = json.load(response).get('elements', [])
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return []

    nearest = {}
    for element in elements:
        tags = element.get('tags', {})
        point = element.get('center') or element
        if 'lat' not in point or 'lon' not in point or not tags.get('name'):
            continue
        distance = haversine_km(latitude, longitude, point['lat'], point['lon'])
        for label, _, matches in NEARBY_CATEGORIES:
            if matches(tags) and (label not in nearest or distance < nearest[label][1]):
                nearest[label] = (tags['name'], distance)
    return [
        f'{label}: {nearest[label][0]} ~{_format_km(nearest[label][1])}'
        for label, _, _ in NEARBY_CATEGORIES
        if label in nearest
    ]


def ensure_center(level, il, ilce='', mahalle=''):
    """Merkez koordinatını önbellekten (LandCenter) döner; hiç sorgulanmamışsa Nominatim'den bulup kaydeder."""
    key = center_identity(level, il, ilce, mahalle)
    center = LandCenter.objects.filter(cache_key=key).first()
    if center is None:
        query = center_query(level, il, ilce, mahalle)
        try:
            result = fetch_nominatim_center(query)
        except RuntimeError:
            return None  # geçici hata: kaydetme, sonraki ilanda yeniden denensin
        latitude, longitude, display_name = result if result else (None, None, '')
        center = LandCenter.objects.create(
            cache_key=key, level=level, query=query,
            latitude=latitude, longitude=longitude, display_name=display_name,
        )
        time.sleep(1)  # Nominatim kuralı: saniyede en fazla 1 istek
    if center.latitude is None or center.longitude is None:
        return None
    return float(center.latitude), float(center.longitude)


def driving_route(latitude, longitude, target, timeout=15):
    """OSRM ile araçla (km, dakika); servis yanıt vermezse None."""
    url = f'{OSRM_URL}/{longitude},{latitude};{target[1]},{target[0]}?overview=false'
    try:
        with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=timeout) as response:
            route = json.load(response)['routes'][0]
    except (HTTPError, URLError, TimeoutError, ValueError, OSError, KeyError, IndexError):
        return None
    return route['distance'] / 1000, round(route['duration'] / 60)


def center_distance_lines(land):
    """İlçe ve il merkezine araçla mesafe/süre (OSRM); rota yoksa kuş uçuşu."""
    lines = []
    for label, level, name in (('ilçe', 'district', land.ilce), ('il', 'city', land.il)):
        target = ensure_center(level, land.il, land.ilce if level == 'district' else '')
        if target is None:
            continue
        route = driving_route(land.latitude, land.longitude, target)
        if route:
            lines.append(f'{name} ({label} merkezi): araçla ~{route[0]:.0f} km, ~{route[1]} dk')
        else:
            straight = haversine_km(land.latitude, land.longitude, *target)
            lines.append(f'{name} ({label} merkezi): kuş uçuşu ~{_format_km(straight)}')
    return lines


def land_facts(land):
    """İlana girecek bilgiler; boş alanlar gönderilmez (Claude o satırları ilandan çıkarır)."""
    facts = {
        # --- Arsa kaydı ---
        'İl': land.il,
        'İlçe': land.ilce,
        'Mahalle': land.mahalle,
        'Ada/Parsel': f'{land.ada}/{land.parsel}',
        'Tapu tipi': f'Hisseli (hisse no: {land.hisse_no})' if land.ownership_type == 'HISSELI' else 'Müstakil',
        # --- TKGM ---
        'Alan': _format_area(land.parcel_area) if land.parcel_area is not None else '',
        'Nitelik': land.parcel_quality,
        'İmar': imar_bilgisi(land.parcel_quality, land.listing_imar_detail),
        'Mevki': land.parcel_locality,
    }
    # --- Harita ---
    if land.latitude is not None and land.longitude is not None:
        facts['Yakındaki yerler'] = '; '.join(fetch_nearby_places(land.latitude, land.longitude))
        facts['Mesafeler'] = '; '.join(center_distance_lines(land))
        facts['Konum (enlem, boylam)'] = f'{land.latitude}, {land.longitude}'
    return {key: value for key, value in facts.items() if value}


PLACEHOLDER = re.compile(r'\[[^\[\]]+\]')


# Şablondaki madde listeli bölüm başlıkları (altında madde kalmazsa başlık da silinir).
SECTION_HEADINGS = ('📍', '🛒', '🚗', '✨')
BULLETS = ('*', '-', '•')
# İlana hiç girmeyecek bilgiler: yol / elektrik-su satırları ve çevre-yapılaşma bölümü.
REMOVED_LINE = re.compile(r'^\s*[*\-•]\s*(Yol|Elektrik)', re.IGNORECASE)
REMOVED_SECTIONS = ('🏗',)


def remove_placeholders(text):
    """Güvenlik ağı: köşeli parantezli yer tutucu kalan satırları ve altında madde kalmayan bölüm başlıklarını siler."""
    lines = []
    in_removed_section = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(REMOVED_SECTIONS):
            in_removed_section = True
            continue
        if in_removed_section and (stripped.startswith(BULLETS) or not stripped):
            if not stripped:
                in_removed_section = False
                lines.append(line)
            continue
        in_removed_section = False
        if PLACEHOLDER.search(line) or REMOVED_LINE.match(line):
            continue
        lines.append(line)
    result = []
    for index, line in enumerate(lines):
        if line.strip().startswith(SECTION_HEADINGS):
            following = next((item.strip() for item in lines[index + 1:] if item.strip()), '')
            if not following.startswith(BULLETS):
                continue
        result.append(line)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(result)).strip()


def _final_text(content):
    """Web araması bloklarından sonra gelen son metni birleştirir (aramadan önceki ara cümleler alınmaz)."""
    last_tool_index = max(
        (index for index, block in enumerate(content) if block.type in ('server_tool_use', 'web_search_tool_result')),
        default=-1,
    )
    return ''.join(block.text for block in content[last_tool_index + 1:] if block.type == 'text').strip()


def generate_listing_text(land):
    details = '\n'.join(f'- {key}: {value}' for key, value in land_facts(land).items())
    messages = [{'role': 'user', 'content': f'Bu arsa için ilan yaz:\n{details}'}]
    try:
        client = anthropic.Anthropic(timeout=180.0)
        for _ in range(MAX_CONTINUATIONS + 1):
            response = client.beta.messages.create(
                model=MODEL,
                max_tokens=8000,
                output_config={'effort': 'medium'},
                # Güvenlik filtresi isteği reddederse aynı istek uygun modelle otomatik yeniden denenir.
                betas=['server-side-fallback-2026-07-01'],
                fallbacks='default',
                system=SISTEM,
                # Web araması: bölge bilgilerini (mesafe, tarihi yerler vb.) güncel bulmak için.
                tools=[{'type': 'web_search_20260209', 'name': 'web_search', 'max_uses': 5}],
                messages=messages,
            )
            if response.stop_reason != 'pause_turn':
                break
            # Uzun arama turu duraklatıldı: yanıtı olduğu gibi ekleyip devam ettir.
            messages = [*messages, {'role': 'assistant', 'content': response.content}]
    except anthropic.AuthenticationError as error:
        raise ListingError('Claude API anahtarı geçersiz. ANTHROPIC_API_KEY ayarını kontrol edin.') from error
    except anthropic.RateLimitError as error:
        raise ListingError('Claude şu an yoğun; birkaç saniye sonra tekrar deneyin.') from error
    except anthropic.APIStatusError as error:
        raise ListingError(f'Claude isteği başarısız oldu (HTTP {error.status_code}).') from error
    except anthropic.APIConnectionError as error:
        raise ListingError("Claude'a bağlanılamadı; internet bağlantısını kontrol edin.") from error
    except (anthropic.AnthropicError, TypeError) as error:
        # Anahtar hiç tanımlı değilse SDK kimlik bilgisi bulamaz ve TypeError fırlatır.
        raise ListingError(
            'Claude API anahtarı bulunamadı. backend/.env dosyasına ANTHROPIC_API_KEY=... ekleyip sunucuyu yeniden başlatın.'
        ) from error

    if response.stop_reason == 'refusal':
        raise ListingError('Claude bu arsa için ilan yazmayı reddetti.')
    text = remove_placeholders(_final_text(response.content))
    if not text:
        raise ListingError('Claude boş yanıt döndü; tekrar deneyin.')
    return text
