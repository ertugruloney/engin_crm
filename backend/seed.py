import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from lands.models import Land

def seed():
    if Land.objects.exists():
        print("Database already seeded.")
        return

    lands = [
        {'il': 'İstanbul', 'ilce': 'Arnavutköy', 'mahalle': 'Yassıören', 'ada': '101', 'parsel': '1', 'status': 'BOS'},
        {'il': 'İstanbul', 'ilce': 'Arnavutköy', 'mahalle': 'Yassıören', 'ada': '101', 'parsel': '2', 'status': 'REZERV', 'reservation_notes': 'Ahmet Yılmaz ilgileniyor. Cuma günü dönecek.'},
        {'il': 'İstanbul', 'ilce': 'Silivri', 'mahalle': 'Çanta', 'ada': '255', 'parsel': '12', 'status': 'KAPORA_ALINDI', 'reservation_notes': 'Kapora: 50.000 TL alındı. Tapu haftaya.'},
        {'il': 'İstanbul', 'ilce': 'Çatalca', 'mahalle': 'İzzettin', 'ada': '402', 'parsel': '5', 'status': 'TAPU'},
        {'il': 'İstanbul', 'ilce': 'Çatalca', 'mahalle': 'İzzettin', 'ada': '402', 'parsel': '6', 'status': 'BOS'},
        {'il': 'Tekirdağ', 'ilce': 'Çerkezköy', 'mahalle': 'Kızılpınar', 'ada': '50', 'parsel': '1', 'status': 'BOS'},
        # Hisseli parsel: 10 hisseye bölünmüş, her hisse ayrı arsa olarak satılır.
        *[
            {'il': 'Tekirdağ', 'ilce': 'Çorlu', 'mahalle': 'Esentepe', 'ada': '45', 'parsel': '7',
             'ownership_type': 'HISSELI', 'hisse_no': str(number), 'status': 'REZERV' if number <= 3 else 'BOS'}
            for number in range(1, 11)
        ],
    ]

    for data in lands:
        Land.objects.create(**data)
    
    print("Database seeded successfully!")

if __name__ == '__main__':
    seed()
