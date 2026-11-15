"""Kimlik fotoğrafı gibi hassas dosyalar için dışarıya kapalı depolama.

Bu dosyalar MEDIA_ROOT altında değil PRIVATE_MEDIA_ROOT altında tutulur; /media/ üzerinden sunulmaz.
Yalnızca yetki kontrolü yapan API uç noktası (lands/<id>/id-images/<side>/) üzerinden okunabilir.
"""
import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivateFileStorage(FileSystemStorage):
    """Konumu her erişimde PRIVATE_MEDIA_ROOT ayarından okur; herkese açık adres (URL) üretmez."""

    @property
    def base_location(self):
        return settings.PRIVATE_MEDIA_ROOT

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @property
    def base_url(self):
        return None

    def url(self, name):
        raise ValueError('Özel dosyaların herkese açık adresi yoktur; yetkili API uç noktasını kullanın.')


_private_storage = PrivateFileStorage()


def private_storage():
    # Çağrılabilir depolama: migration dosyaları ayara bağlı kalmaz.
    return _private_storage


def id_image_path(instance, filename):
    """Dosya adı tahmin edilemesin ve müşteri adını içermesin diye rastgele ad verilir."""
    extension = os.path.splitext(filename)[1].lower()[:10]
    return f'id_images/{uuid.uuid4().hex}{extension}'


def delete_stored_files(storage_names):
    """Verilen adlardaki özel dosyaları siler (boş adlar atlanır)."""
    storage = private_storage()
    for name in storage_names:
        if name and storage.exists(name):
            storage.delete(name)
