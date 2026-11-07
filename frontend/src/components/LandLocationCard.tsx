import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Copy, ExternalLink, MapPin, Navigation, Pencil } from 'lucide-react';
import { updateLandLocation } from '../api';
import type { Land } from '../types';
import {
  PARCEL_QUERY_HOME,
  directionsUrl,
  embeddedMapUrl,
  formatCoordinates,
  mapsUrl,
  parseCoordinates,
} from '../landLocation';
import TkgmParcelPanel from './TkgmParcelPanel';
import WhatsAppButton from './WhatsAppButton';

type LocatableLand = Pick<Land, 'id' | 'il' | 'ilce' | 'mahalle' | 'ada' | 'parsel'> &
  Partial<Pick<Land, 'parcel_area' | 'parcel_quality' | 'parcel_locality' | 'parcel_sheet' | 'parcel_geometry' | 'tkgm_synced_at'>> & {
  latitude?: string | null;
  longitude?: string | null;
  parcel_query_url?: string;
  parcel_query_url_auto?: string;
  customer_name?: string;
  customer_phone?: string;
};

const errorText = (error: unknown) => {
  if (isAxiosError<Record<string, unknown>>(error) && error.response?.data) {
    const messages = Object.values(error.response.data).flatMap(value => (Array.isArray(value) ? value : [value]));
    const text = messages.filter((value): value is string => typeof value === 'string').join(' ');
    if (text) return text;
  }
  return error instanceof Error ? error.message : 'Konum kaydedilemedi.';
};

const LINK_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-slate-50';

// Arsanın haritadaki yeri ve Tapu Kadastro Parsel Sorgu bağlantısı; satışçı müşteriye doğru yeri gösterir.
export default function LandLocationCard({ land, canEdit }: { land: LocatableLand; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [coordinateText, setCoordinateText] = useState('');
  const [queryUrl, setQueryUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const hasCoordinates = land.latitude != null && land.longitude != null;
  // Kayıtlı link yoksa aynı mahalleden öğrenilmiş kalıpla üretilen link kullanılır.
  const queryLink = land.parcel_query_url || land.parcel_query_url_auto || '';
  const isAutoLink = !land.parcel_query_url && Boolean(land.parcel_query_url_auto);
  const parcelText = `${land.il} / ${land.ilce} / ${land.mahalle} · Ada ${land.ada} · Parsel ${land.parsel}`;

  const mutation = useMutation({
    mutationFn: () => {
      const coordinates = parseCoordinates(coordinateText);
      return updateLandLocation(land.id, {
        latitude: coordinates ? coordinates.latitude.toFixed(6) : null,
        longitude: coordinates ? coordinates.longitude.toFixed(6) : null,
        parcel_query_url: queryUrl.trim(),
      });
    },
    onSuccess: updatedLand => {
      queryClient.setQueryData<Land[]>(['lands'], current => current?.map(item => (item.id === updatedLand.id ? updatedLand : item)));
      queryClient.invalidateQueries({ queryKey: ['lands'] });
      queryClient.invalidateQueries({ queryKey: ['landHistory', updatedLand.id] });
      setEditing(false);
    },
  });

  const coordinateError =
    coordinateText.trim() && !parseCoordinates(coordinateText)
      ? coordinateText.includes('goo.gl')
        ? 'Kısa linkten koordinat okunamıyor. Google Haritalar’da konuma basılı tutup çıkan koordinatı (ör. 39.7912, 32.8056) yapıştırın.'
        : 'Koordinat okunamadı. Örnek: 39.7912, 32.8056 ya da bir Google Haritalar linki.'
      : null;

  const startEditing = () => {
    setCoordinateText(hasCoordinates ? formatCoordinates(land.latitude!, land.longitude!) : '');
    setQueryUrl(land.parcel_query_url ?? '');
    mutation.reset();
    setEditing(true);
  };

  const copyParcel = async () => {
    try {
      await navigator.clipboard.writeText(parcelText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const shareMessage = [
    `Merhaba ${land.customer_name ?? ''}, ${land.il} / ${land.ilce} · ${land.mahalle}, Ada ${land.ada} / Parsel ${land.parsel} arsasının konumu:`,
    hasCoordinates ? mapsUrl(land.latitude!, land.longitude!) : '',
    queryLink ? `Tapu Kadastro parsel sorgu: ${queryLink}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-slate-500">
          <MapPin size={15} />
          Konum
        </h3>
        {canEdit && !editing && (
          <button type="button" onClick={startEditing} className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
            <Pencil size={14} /> {hasCoordinates || land.parcel_query_url ? 'Düzenle' : 'Konum ekle'}
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!coordinateError) mutation.mutate();
          }}
          className="space-y-3"
        >
          <label className="block text-sm font-medium text-slate-700">
            Koordinat veya Google Haritalar linki
            <input
              value={coordinateText}
              onChange={event => setCoordinateText(event.target.value)}
              placeholder="39.7912, 32.8056"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Telefonda Google Haritalar’da arsanın üstüne basılı tutun; çıkan koordinatı kopyalayıp buraya yapıştırın.
            </span>
          </label>
          {coordinateError && <p className="text-sm text-amber-700">{coordinateError}</p>}
          <label className="block text-sm font-medium text-slate-700">
            Tapu Kadastro Parsel Sorgu linki
            <input
              type="url"
              value={queryUrl}
              onChange={event => setQueryUrl(event.target.value)}
              placeholder="https://parselsorgu.tkgm.gov.tr/#ara/idari/..."
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              <a href={PARCEL_QUERY_HOME} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">
                Parsel Sorgu’yu açın
              </a>
              , il/ilçe/mahalle/ada/parsel ile arayın ve adres çubuğundaki linki buraya yapıştırın. Bir mahalleden tek bir
              arsanın linkini kaydetmeniz yeterli: aynı mahalledeki diğer arsaların linki ada/parsel numarasına göre otomatik oluşur.
            </span>
          </label>
          {mutation.isError && <p role="alert" className="text-sm text-red-600">{errorText(mutation.error)}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || Boolean(coordinateError)}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Kaydediliyor...' : 'Konumu kaydet'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {hasCoordinates ? (
            <>
              <iframe
                title={`Ada ${land.ada} / Parsel ${land.parsel} harita konumu`}
                src={embeddedMapUrl(land.latitude!, land.longitude!)}
                loading="lazy"
                className="h-44 w-full rounded-lg border border-slate-200"
              />
              <p className="font-mono text-xs text-slate-500">{formatCoordinates(land.latitude!, land.longitude!)}</p>
              <div className="flex flex-wrap gap-2">
                <a href={mapsUrl(land.latitude!, land.longitude!)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
                  <MapPin size={15} />
                  Haritada aç
                </a>
                <a href={directionsUrl(land.latitude!, land.longitude!)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
                  <Navigation size={15} />
                  Yol tarifi
                </a>
              </div>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
              Koordinat girilmemiş.{canEdit ? ' “Konum ekle” ile arsanın yerini işaretleyin.' : ''}
            </p>
          )}

          <TkgmParcelPanel land={land} canEdit={canEdit} />

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Tapu Kadastro Parsel Sorgu</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {queryLink ? (
                <a href={queryLink} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
                  <ExternalLink size={15} />
                  Parsel Sorgu’da aç
                </a>
              ) : (
                <>
                  <a href={PARCEL_QUERY_HOME} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
                    <ExternalLink size={15} />
                    Parsel Sorgu’yu aç
                  </a>
                  <button type="button" onClick={copyParcel} className={LINK_BUTTON}>
                    <Copy size={15} />
                    {copied ? 'Kopyalandı' : 'Ada/parsel bilgisini kopyala'}
                  </button>
                </>
              )}
            </div>
            {isAutoLink && (
              <p className="mt-2 text-xs text-slate-500">
                Link, aynı mahalleden kaydedilmiş bir arsanın linkinden ada/parsel numarasına göre otomatik oluşturuldu.
                {canEdit && ' Yanlış açılırsa doğru linki “Düzenle” ile kaydedin.'}
              </p>
            )}
            {!queryLink && <p className="mt-2 text-xs text-slate-500">{parcelText}</p>}
          </div>

          {land.customer_phone && (hasCoordinates || queryLink) && (
            <WhatsAppButton phone={land.customer_phone} label="Konumu müşteriye gönder" message={shareMessage} />
          )}
        </div>
      )}
    </section>
  );
}
