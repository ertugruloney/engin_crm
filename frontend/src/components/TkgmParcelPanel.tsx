import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Landmark, RefreshCw } from 'lucide-react';
import { syncLandFromTkgm } from '../api';
import type { TkgmNeighborhoodChoice } from '../api';
import type { Land } from '../types';

type TkgmLand = Pick<Land, 'id' | 'ilce' | 'mahalle' | 'ada' | 'parsel'> &
  Partial<Pick<Land, 'parcel_area' | 'parcel_quality' | 'parcel_locality' | 'parcel_sheet' | 'parcel_geometry' | 'tkgm_synced_at'>>;

const formatArea = (value: string) =>
  `${Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} m²`;

// Parsel sınırını (boylam, enlem) köşe noktalarından ölçekli bir şekil olarak çizer.
function ParcelShape({ points, area }: { points: [number, number][]; area?: string | null }) {
  const width = 220;
  const height = 150;
  const padding = 12;
  const meanLatitude = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  const scaleX = Math.cos((meanLatitude * Math.PI) / 180);
  const xs = points.map(([lng]) => lng * scaleX);
  const ys = points.map(([, lat]) => lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - padding * 2) / (maxX - minX || 1), (height - padding * 2) / (maxY - minY || 1));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const path = points
    .map(([lng, lat], index) => `${index ? 'L' : 'M'}${(lng * scaleX - minX) * scale + offsetX},${(maxY - lat) * scale + offsetY}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Parsel sınırı" className="h-36 w-full rounded-lg bg-slate-50">
      <path d={`${path} Z`} fill="#dbeafe" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" />
      {area && (
        <text x={width / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#334155">
          {formatArea(area)}
        </text>
      )}
    </svg>
  );
}

// TKGM Parsel Sorgu bilgileri: alan, nitelik, mevki, pafta ve parsel şekli; yetkiliyse tek tuşla getirilir.
export default function TkgmParcelPanel({ land, canEdit }: { land: TkgmLand; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<TkgmNeighborhoodChoice[]>([]);
  const [choice, setChoice] = useState('');
  const mutation = useMutation({
    mutationFn: (mahalleId?: number) => syncLandFromTkgm(land.id, mahalleId),
    onSuccess: updatedLand => {
      setChoices([]);
      queryClient.setQueryData<Land[]>(['lands'], current => current?.map(item => (item.id === updatedLand.id ? updatedLand : item)));
      queryClient.invalidateQueries({ queryKey: ['lands'] });
      queryClient.invalidateQueries({ queryKey: ['landHistory', updatedLand.id] });
    },
    onError: error => {
      const candidates = isAxiosError<{ candidates?: TkgmNeighborhoodChoice[] }>(error) ? error.response?.data?.candidates : undefined;
      setChoices(candidates ?? []);
      setChoice('');
    },
  });
  const errorMessage = mutation.error
    ? (isAxiosError<{ detail?: string }>(mutation.error) && mutation.error.response?.data?.detail) || 'TKGM bilgileri alınamadı.'
    : null;
  const synced = Boolean(land.tkgm_synced_at);

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <Landmark size={14} />
          Tapu Kadastro bilgileri
        </p>
        {canEdit && synced && (
          <button
            type="button"
            onClick={() => mutation.mutate(undefined)}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={12} className={mutation.isPending ? 'animate-spin' : ''} />
            Yenile
          </button>
        )}
      </div>

      {synced ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {[
              ['Alan', land.parcel_area ? formatArea(land.parcel_area) : '—'],
              ['Nitelik', land.parcel_quality || '—'],
              ['Mevki', land.parcel_locality || '—'],
              ['Pafta', land.parcel_sheet || '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="font-medium text-slate-800">{value}</dd>
              </div>
            ))}
            <p className="col-span-2 text-xs text-slate-400">
              TKGM'den alındı: {new Date(land.tkgm_synced_at!).toLocaleDateString('tr-TR')}
            </p>
          </dl>
          {land.parcel_geometry && land.parcel_geometry.length > 2 ? (
            <ParcelShape points={land.parcel_geometry} area={land.parcel_area} />
          ) : (
            <p className="self-center rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
              TKGM bu parselin sınırını paylaşmıyor; şekil çizilemedi. Konumu “Düzenle” ile elle işaretleyebilirsiniz.
            </p>
          )}
        </div>
      ) : canEdit ? (
        <div className="mt-2">
          <p className="text-xs text-slate-500">
            Ada/parsel bilgisiyle TKGM'de aranır: doğrudan Parsel Sorgu linki, alan, nitelik ve parselin sınırı gelir;
            koordinat boşsa parselin ortası işaretlenir.
          </p>
          <button
            type="button"
            onClick={() => mutation.mutate(undefined)}
            disabled={mutation.isPending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Landmark size={15} />
            {mutation.isPending ? "TKGM'de aranıyor..." : "TKGM'den bilgileri getir"}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Henüz TKGM'den bilgi alınmadı.</p>
      )}

      {errorMessage && <p role="alert" className="mt-2 text-sm text-amber-700">{errorMessage}</p>}
      {canEdit && choices.length > 0 && (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (choice) mutation.mutate(Number(choice));
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <label className="min-w-[12rem] flex-1 text-xs font-medium text-slate-600">
            {land.ilce} ilçesindeki doğru mahalleyi seçin
            <select
              value={choice}
              onChange={event => setChoice(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
            >
              <option value="">Mahalle seçin</option>
              {choices.map(item => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!choice || mutation.isPending}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Bu mahalleyle dene
          </button>
        </form>
      )}
    </div>
  );
}
