"""TKGM bilgisi alınmamış arsaları Parsel Sorgu servisinden doldurur.

Kullanım:
    python manage.py tkgm_sync                 # en fazla 50 arsa, istekler arasında 1 sn bekler
    python manage.py tkgm_sync --limit 200 --delay 1.5
"""
import time

from django.core.management.base import BaseCommand

from lands import tkgm
from lands.models import Land
from lands.parcel_links import learn_from_land
from lands.tkgm_sync import ParcelNotFound, sync_land_from_tkgm


class Command(BaseCommand):
    help = "TKGM Parsel Sorgu'dan arsaların mahalle numarası, parsel bilgileri ve koordinatını çeker."

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=50, help='İşlenecek en fazla arsa sayısı.')
        parser.add_argument('--delay', type=float, default=1.0, help='Arsalar arasında beklenecek saniye.')

    def handle(self, *args, **options):
        lands = Land.objects.filter(tkgm_synced_at__isnull=True).order_by('id')[: options['limit']]
        found = missing = 0
        for index, land in enumerate(lands):
            if index:
                time.sleep(options['delay'])
            label = f'{land.il} / {land.ilce} / {land.mahalle} · Ada {land.ada} / Parsel {land.parsel}'
            try:
                sync_land_from_tkgm(land)
            except ParcelNotFound as error:
                missing += 1
                self.stdout.write(self.style.WARNING(f'Bulunamadı: {label} ({error})'))
                continue
            except tkgm.TkgmError as error:
                self.stdout.write(self.style.ERROR(f'TKGM hatası, durduruldu: {error}'))
                break
            learn_from_land(land)
            found += 1
            self.stdout.write(f'Bulundu: {label} · {land.parcel_area or "?"} m² · {land.parcel_quality or "-"}')
        self.stdout.write(self.style.SUCCESS(f'{found} arsa güncellendi, {missing} arsa bulunamadı.'))
