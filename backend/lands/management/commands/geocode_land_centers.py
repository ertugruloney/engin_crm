"""Arsa kartlarında kullanılacak il, ilçe ve mahalle merkezlerini OpenStreetMap'ten önbelleğe alır."""
import time
from decimal import Decimal

from django.core.management.base import BaseCommand

from lands.center_distances import center_identity, center_query, fetch_nominatim_center
from lands.models import Land, LandCenter


class Command(BaseCommand):
    help = 'Arsa merkezlerini OpenStreetMap/Nominatim ile bulup uzaklık hesabı için önbelleğe alır.'

    def add_arguments(self, parser):
        parser.add_argument('--delay', type=float, default=1.1, help='Nominatim istekleri arasındaki bekleme süresi (saniye).')
        parser.add_argument('--retry-failed', action='store_true', help='Daha önce bulunamayan merkezleri yeniden sorgula.')

    def handle(self, *args, **options):
        places = set()
        for il, ilce, mahalle in Land.objects.filter(
            latitude__isnull=False,
            longitude__isnull=False,
        ).values_list('il', 'ilce', 'mahalle').distinct().iterator():
            places.add(('city', il, '', ''))
            places.add(('district', il, ilce, ''))
            places.add(('neighborhood', il, ilce, mahalle))

        places = sorted(places)
        existing = {
            center.cache_key: center.latitude
            for center in LandCenter.objects.filter(
                cache_key__in=[center_identity(*place) for place in places]
            ).only('cache_key', 'latitude')
        }
        places = [
            place for place in places
            if center_identity(*place) not in existing
            or (options['retry_failed'] and existing[center_identity(*place)] is None)
        ]

        found = missing = 0
        for index, (level, il, ilce, mahalle) in enumerate(places):
            if index:
                time.sleep(max(1.0, options['delay']))
            query = center_query(level, il, ilce, mahalle)
            cache_key = center_identity(level, il, ilce, mahalle)
            try:
                result = fetch_nominatim_center(query)
            except RuntimeError as error:
                LandCenter.objects.update_or_create(
                    cache_key=cache_key,
                    defaults={'level': level, 'query': query, 'latitude': None, 'longitude': None, 'display_name': ''},
                )
                missing += 1
                self.stderr.write(self.style.ERROR(f'Merkez alınamadı ({query}): {error}'))
                continue

            if result is None:
                LandCenter.objects.update_or_create(
                    cache_key=cache_key,
                    defaults={'level': level, 'query': query, 'latitude': None, 'longitude': None, 'display_name': ''},
                )
                missing += 1
                self.stderr.write(self.style.WARNING(f'Merkez bulunamadı: {query}'))
                continue

            latitude, longitude, display_name = result
            LandCenter.objects.update_or_create(
                cache_key=cache_key,
                defaults={
                    'level': level,
                    'query': query,
                    'latitude': Decimal(str(latitude)),
                    'longitude': Decimal(str(longitude)),
                    'display_name': display_name,
                },
            )
            found += 1
            self.stdout.write(f'Merkez kaydedildi: {query}')

        self.stdout.write(self.style.SUCCESS(f'{found} merkez bulundu, {missing} merkez alınamadı.'))
