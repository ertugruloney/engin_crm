import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, IdCard, ImagePlus } from 'lucide-react';
import { downloadTitleDeedImage } from '../api';

export type IdImageSide = 'front' | 'back';
export type IdImages = Record<IdImageSide, File | null>;

export const EMPTY_ID_IMAGES: IdImages = { front: null, back: null };

const SIDES: { side: IdImageSide; label: string }[] = [
  { side: 'front', label: 'Kimlik ön yüz' },
  { side: 'back', label: 'Kimlik arka yüz' },
];

const MAX_BYTES = 10 * 1024 * 1024;
// "image/*": Android'de seçicide kamera seçeneği de çıksın (tür listesi verilince bazı telefonlarda gizleniyor).
const ACCEPT = 'image/*';
// Yüklemeden önce küçültme: kimlik okunur kalır, mobil veride hızlı yüklenir ve boyut sınırına takılmaz.
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Fotoğraf okunamadı.'));
    };
    image.src = url;
  });

/** Kamera fotoğrafını en uzun kenarı MAX_DIMENSION olan JPEG'e çevirir; tarayıcı okuyamazsa dosyayı olduğu gibi döner. */
export const prepareIdPhoto = async (file: File): Promise<File> => {
  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    // Telefon fotoğrafındaki yön bilgisi (EXIF) tarayıcı tarafından çizimde uygulanır.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'kimlik';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
};

/** API'nin beklediği alan adlarına çevirir: { id_front_image, id_back_image }. */
export const idImagesPayload = (images: IdImages) => ({
  ...(images.front ? { id_front_image: images.front } : {}),
  ...(images.back ? { id_back_image: images.back } : {}),
});

/** Zorunluysa iki yüz de seçilmiş ve boyut sınırı içinde olmalı; değilse hata metni döner. */
export const idImagesError = (images: IdImages, required: boolean) => {
  if (Object.values(images).some(file => file && file.size > MAX_BYTES)) return 'Kimlik fotoğrafları 10 MB boyutunu aşamaz.';
  if (required && (!images.front || !images.back)) return 'Kimliğin ön ve arka yüz fotoğraflarını yükleyin.';
  return null;
};

function SelectedPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null;
}

/**
 * Kapora adımında kimliğin ön ve arka yüz fotoğrafını seçtirir.
 * required: kapora aşamasına ilk geçişte zorunlu; existing: arsada zaten kayıtlı fotoğraf var (değiştirmek isteğe bağlı).
 */
export function IdImageFields({
  value,
  onChange,
  required,
  existing = { front: false, back: false },
  showError = false,
}: {
  value: IdImages;
  onChange: (images: IdImages) => void;
  required: boolean;
  existing?: Record<IdImageSide, boolean>;
  showError?: boolean;
}) {
  // Fotoğraf hazırlanırken diğer yüz de seçilmiş olabilir; en güncel değerin üzerine yazılır.
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);
  const error = idImagesError(value, required);
  const [preparing, setPreparing] = useState<Record<IdImageSide, boolean>>({ front: false, back: false });
  const handleFile = async (side: IdImageSide, event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    // Aynı fotoğraf yeniden seçilebilsin diye input sıfırlanır.
    event.target.value = '';
    if (!selected) return;
    setPreparing(current => ({ ...current, [side]: true }));
    const prepared = await prepareIdPhoto(selected);
    setPreparing(current => ({ ...current, [side]: false }));
    onChange({ ...latestValue.current, [side]: prepared });
  };
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">
        Kimlik fotoğrafları {required && <span className="text-red-600">(zorunlu)</span>}
      </legend>
      <div className="mt-1 grid grid-cols-2 gap-3">
        {SIDES.map(({ side, label }) => {
          const file = value[side];
          const tooLarge = Boolean(file && file.size > MAX_BYTES);
          const isPreparing = preparing[side];
          return (
            <div key={side} className="min-w-0 space-y-1.5">
              {/* Dokununca telefon galeri veya kamera seçeneği sunar; bilgisayarda dosya seçtirir. */}
              <label
                className={`group relative flex aspect-[1.58] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition-colors ${
                  tooLarge
                    ? 'border-red-300 bg-red-50'
                    : file
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
                }`}
              >
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  aria-label={`${label} – fotoğraf seç`}
                  disabled={isPreparing}
                  onChange={event => handleFile(side, event)}
                />
                {isPreparing ? (
                  <span className="text-xs text-slate-500">Fotoğraf hazırlanıyor...</span>
                ) : file ? (
                  <>
                    <SelectedPreview file={file} />
                    <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-white">
                      {label} · değiştir
                    </span>
                  </>
                ) : (
                  <span className="flex flex-col items-center gap-1 px-2 text-xs text-slate-500">
                    <ImagePlus size={22} className="text-slate-400 group-hover:text-blue-500" />
                    <span className="font-medium text-slate-700">{label}</span>
                    {existing[side] ? 'Kayıtlı · değiştirmek için seçin' : 'Fotoğraf seç'}
                  </span>
                )}
              </label>
              {/* Telefonda arka kamerayı doğrudan açar. */}
              <label
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 active:bg-blue-100 md:hidden ${
                  isPreparing ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                <input
                  type="file"
                  accept={ACCEPT}
                  capture="environment"
                  className="sr-only"
                  aria-label={`${label} – kamerayla çek`}
                  disabled={isPreparing}
                  onChange={event => handleFile(side, event)}
                />
                <Camera size={15} />
                {file ? 'Yeniden çek' : 'Kamerayla çek'}
              </label>
            </div>
          );
        })}
      </div>
      {showError && error && <p role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
      <p className="mt-1.5 text-[11px] text-slate-400">
        Fotoğraflar yalnızca yönetici ve satış destek tarafından görülebilir.
      </p>
    </fieldset>
  );
}

function StoredIdImage({ url, label }: { url: string; label: string }) {
  const query = useQuery({
    queryKey: ['idImage', url],
    queryFn: async () => URL.createObjectURL(await downloadTitleDeedImage(url)),
    staleTime: Infinity,
    gcTime: 60_000,
  });
  useEffect(() => {
    const objectUrl = query.data;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [query.data]);

  return (
    <figure className="min-w-0">
      {query.data ? (
        <a href={query.data} target="_blank" rel="noreferrer" title={`${label} – büyütmek için tıklayın`}>
          <img src={query.data} alt={label} className="aspect-[1.58] w-full rounded-lg border border-slate-200 object-cover" />
        </a>
      ) : (
        <div className="flex aspect-[1.58] w-full items-center justify-center rounded-lg border border-slate-200 bg-white text-xs text-slate-400">
          {query.isError ? 'Yüklenemedi' : 'Yükleniyor...'}
        </div>
      )}
      <figcaption className="mt-1 text-xs text-slate-500">{label}</figcaption>
    </figure>
  );
}

/** Kayıtlı kimlik fotoğrafları (yetkili API'den oturumla indirilir; herkese açık adresleri yoktur). */
export function StoredIdImages({ front, back }: { front?: string | null; back?: string | null }) {
  if (!front && !back) {
    return (
      <p className="flex items-center gap-2 text-xs text-amber-700">
        <IdCard size={14} /> Kimlik fotoğrafı yüklenmemiş.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {front ? <StoredIdImage url={front} label="Kimlik ön yüz" /> : <span />}
      {back ? <StoredIdImage url={back} label="Kimlik arka yüz" /> : <span />}
    </div>
  );
}
