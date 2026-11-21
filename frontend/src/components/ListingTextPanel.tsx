import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Sparkles } from 'lucide-react';
import { updateListingImarDetail } from '../api';
import type { RepresentativeLand } from '../api';

// Yapay zekâ ilan metni: şimdilik yalnızca tasarım şablonu olarak gösterilir, ilan üretilmez.
// Backend uç noktası (POST /api/lands/<id>/listing/, bkz. listing_views) hazırdır; tekrar açmak için
// butona generateLandListing çağrısı bağlanıp oluşan metin aşağıdaki alana yazdırılabilir.
export default function ListingTextPanel({ land }: { land: { id: number; listing_imar_detail?: string } }) {
  const queryClient = useQueryClient();
  const [imarDetail, setImarDetail] = useState(land.listing_imar_detail ?? '');
  const [saved, setSaved] = useState(land.listing_imar_detail ?? '');
  const saveMutation = useMutation({
    mutationFn: () => updateListingImarDetail(land.id, imarDetail.trim()),
    onSuccess: data => {
      setImarDetail(data.listing_imar_detail);
      setSaved(data.listing_imar_detail);
      queryClient.setQueryData<RepresentativeLand[]>(['representativeLands'], current =>
        current?.map(item => (item.id === land.id ? { ...item, listing_imar_detail: data.listing_imar_detail } : item)),
      );
    },
  });
  const isDirty = imarDetail.trim() !== saved;
  const saveError = saveMutation.error
    ? (isAxiosError<{ detail?: string; listing_imar_detail?: string[] }>(saveMutation.error)
      && (saveMutation.error.response?.data?.listing_imar_detail?.[0] || saveMutation.error.response?.data?.detail))
      || 'İmar detayı kaydedilemedi.'
    : null;

  return (
    <section className="mb-6 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-violet-700">
        <Sparkles size={15} />
        İlan metni
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Konum, ada/parsel, alan, nitelik ve harita mesafeleri otomatik alınır; bölge bilgisi web aramasıyla eklenir.
      </p>
      <form
        onSubmit={event => {
          event.preventDefault();
          if (isDirty) saveMutation.mutate();
        }}
        className="mb-3"
      >
        <label htmlFor={`imar-detail-${land.id}`} className="block text-xs font-medium text-slate-600">
          İmar detayı (belgeden)
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`imar-detail-${land.id}`}
            type="text"
            maxLength={300}
            value={imarDetail}
            onChange={event => {
              setImarDetail(event.target.value);
              saveMutation.reset();
            }}
            placeholder="ör. Villa imarlı %15/%30, 2 kat — boşsa TKGM niteliğinden çıkarılır"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          />
          <button
            type="submit"
            disabled={!isDirty || saveMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >
            {saveMutation.isSuccess && !isDirty ? <Check size={13} /> : null}
            {saveMutation.isPending ? 'Kaydediliyor...' : saveMutation.isSuccess && !isDirty ? 'Kaydedildi' : 'Kaydet'}
          </button>
        </div>
        {saveError && <p role="alert" className="mt-1 text-xs text-red-600">{saveError}</p>}
      </form>

      {/* Şimdilik tıklanınca hiçbir şey yapmaz; ilan üretimi bağlandığında generateLandListing çağrılacak. */}
      <button
        type="button"
        onClick={() => {}}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
      >
        <Sparkles size={15} />
        İlan metni oluştur
      </button>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">Oluşan ilan</span>
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-400"
          >
            <Copy size={13} />
            Kopyala
          </button>
        </div>
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-400">
          İlan metni burada görünecek.
        </div>
      </div>
    </section>
  );
}
