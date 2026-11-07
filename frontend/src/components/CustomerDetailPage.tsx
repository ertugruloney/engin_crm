import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Flame, MapPin, Pencil, Phone, UserRound } from 'lucide-react';
import { getCustomer, getLands, updateCustomer } from '../api';
import type { CancelDetail, CancelReason, CustomerInput } from '../api';
import { OUTCOME_INFO, SOURCE_LABELS, cancelReasonLabel, formatCurrency, formatDate, initials, isHotLead, regionKey } from '../customerDisplay';
import { statusLabels } from '../types';
import WhatsAppButton from './WhatsAppButton';

const CARD = 'rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,35,95,0.06)] ring-1 ring-slate-100';
const INPUT =
  'mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

const STAGE_TEXT = {
  BOS: 'Satışa uygun',
  REZERV: 'Rezerv aşamasına kadar geldi',
  KAPORA_ALINDI: 'Kapora verdi',
  TAPU: 'Tapusu verildi',
} as const;

const errorText = (error: unknown) => {
  if (isAxiosError<Record<string, unknown>>(error) && error.response?.data) {
    const messages = Object.values(error.response.data).flatMap(value => (Array.isArray(value) ? value : [value]));
    const text = messages.filter((value): value is string => typeof value === 'string').join(' ');
    if (text) return text;
  }
  return error instanceof Error ? error.message : 'Kaydedilemedi.';
};

// "İl, İlçe, Mahalle, Ada X / Parsel Y" -> konum ve parsel satırı
const splitLabel = (label: string) => {
  const parts = label.split(',').map(part => part.trim());
  return parts.length >= 4
    ? { place: `${parts[0]} / ${parts[1]} · ${parts[2]}`, parcel: parts.slice(3).join(', ') }
    : { place: label, parcel: '' };
};

// Arsa geçmişindeki kayda göre hazır WhatsApp mesajı.
// İptal nedenine (ve alt seçimine) göre müşteriyi geri kazanmaya yönelik teklif cümlesi.
const comebackOffer = (reason: CancelReason | '', detail: CancelDetail | '') => {
  if (reason === 'fiyat_odeme') {
    return detail === 'fiyat_anlasilamadi' ? 'bütçenize daha uygun seçeneklerimiz var' : 'esnek ödeme ve taksit seçeneklerimiz var';
  }
  if (reason === 'baska_arsa' || reason === 'ozellik' || reason === 'yerinde_gordu') {
    return 'farklı konum ve özellikte yeni arsalarımız var';
  }
  if (reason === 'yanlis_yer') return 'size arsayı yeniden ve doğru şekilde yerinde göstermek isteriz';
  return '';
};

const recordMessage = (
  name: string,
  outcome: 'active' | 'sold' | 'cancelled',
  place: string,
  parcel: string,
  reason: CancelReason | '' = '',
  detail: CancelDetail | '' = '',
) => {
  const land = parcel ? `${place}, ${parcel}` : place;
  if (outcome === 'sold') {
    return `Merhaba ${name}, ${land} arsanız için tekrar teşekkür ederiz. Yardımcı olabileceğimiz bir konu olursa buradayız.`;
  }
  if (outcome === 'cancelled') {
    const offer = comebackOffer(reason, detail) || 'yeni seçeneklerimiz var';
    return `Merhaba ${name}, daha önce ilgilendiğiniz ${place} bölgesinde ${offer}. Görüşmek ister misiniz?`;
  }
  return `Merhaba ${name}, ${land} arsanızla ilgili yazıyorum.`;
};

export default function CustomerDetailPage({ isAdmin }: { isAdmin: boolean }) {
  const { customerId } = useParams();
  const id = Number(customerId);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CustomerInput | null>(null);

  const customerQuery = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id), enabled: Number.isFinite(id) });
  const landsQuery = useQuery({ queryKey: ['lands'], queryFn: getLands });
  const mutation = useMutation({
    mutationFn: (input: CustomerInput) => updateCustomer(id, input),
    onSuccess: async () => {
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customer', id] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['lands'] }),
      ]);
    },
  });

  if (customerQuery.isLoading) return <div className="flex-1 py-12 text-center text-slate-500">Müşteri yükleniyor...</div>;
  if (customerQuery.isError || !customerQuery.data) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-600">Müşteri kaydı bulunamadı.</p>
        <Link to="/customers" className="mt-4 inline-block font-medium text-blue-600 hover:text-blue-700">Müşterilere dön</Link>
      </div>
    );
  }

  const customer = customerQuery.data;
  const hot = isHotLead(customer);
  const lastRecord = customer.records[0];
  const freeLands = hot && lastRecord
    ? (landsQuery.data ?? []).filter(
        land => land.status === 'BOS' && regionKey(land.il, land.ilce) === regionKey(lastRecord.il, lastRecord.ilce),
      )
    : [];
  const openLand = (landId: number) => navigate(`/land/${landId}`, { state: { from: location.pathname } });

  const startEditing = () => {
    setForm({
      full_name: customer.full_name,
      phone: customer.phone,
      national_id: customer.national_id,
      source: customer.source,
      notes: customer.notes,
    });
    mutation.reset();
    setEditing(true);
  };
  const set = (field: keyof CustomerInput) => (event: { target: { value: string } }) =>
    setForm(current => (current ? { ...current, [field]: event.target.value } : current));

  const tiles = [
    { label: 'Satın aldığı arsa', value: customer.purchased_count, color: 'bg-emerald-500' },
    { label: 'Toplam alım', value: customer.purchased_count ? formatCurrency(customer.purchased_total) : '₺0', color: 'bg-violet-500' },
    { label: 'Devam eden süreç', value: customer.active_count, color: 'bg-amber-500' },
    { label: 'İptal ettiği', value: customer.cancelled_count, color: 'bg-rose-500' },
  ];

  return (
    <div className="flex w-full flex-col gap-5">
      <Link to="/customers" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} />
        Müşteriler
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
          {initials(customer.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{customer.full_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            {customer.phone ? (
              <a href={`tel:${customer.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 font-medium text-blue-600 hover:underline">
                <Phone size={14} />
                {customer.phone}
              </a>
            ) : (
              <span>Telefon yok</span>
            )}
            {customer.source && <span>Kaynak: {SOURCE_LABELS[customer.source]}</span>}
            <span>Kayıt: {formatDate(customer.created_at)}</span>
          </p>
        </div>
        <WhatsAppButton
          variant="solid"
          phone={customer.phone}
          message={`Merhaba ${customer.full_name}, Engin Arsa'dan yazıyorum.`}
        />
      </div>

      <section aria-label="Özet" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.label} className={`${CARD} px-4 py-3`}>
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <span className={`h-2.5 w-2.5 rounded-full ${tile.color}`} />
              {tile.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{tile.value}</p>
          </div>
        ))}
      </section>

      {hot && lastRecord && (
        <section className="rounded-2xl border border-rose-100 bg-rose-50 p-5">
          <p className="flex items-start gap-2 font-semibold text-rose-800">
            <Flame size={18} className="mt-0.5 shrink-0" />
           İptal edilenler
          </p>
          <p className="mt-1 text-sm text-rose-800">
            {customer.cancelled_count} kez rezervasyonunu iptal etti, şu an açık süreci yok. Son ilgilendiği bölge:{' '}
            <strong>{lastRecord.il} / {lastRecord.ilce}</strong>.{' '}
            {isAdmin && lastRecord.outcome === 'cancelled' && <>Son iptal nedeni: <strong>{cancelReasonLabel(lastRecord.cancel_reason, lastRecord.cancel_detail)}</strong>.{' '}</>}
            {freeLands.length > 0 ? `Bu ilçede şu an ${freeLands.length} boş arsa var:` : 'Bu ilçede şu an boş arsa yok.'}
          </p>
          {freeLands.length > 0 && (
            <div className="mt-3">
              <WhatsAppButton
                phone={customer.phone}
                label="WhatsApp'tan haber ver"
                message={`Merhaba ${customer.full_name}, daha önce ilgilendiğiniz ${lastRecord.il} / ${lastRecord.ilce} bölgesinde şu an ${freeLands.length} boş arsamız var${
                  isAdmin && comebackOffer(lastRecord.cancel_reason, lastRecord.cancel_detail) ? `; ayrıca ${comebackOffer(lastRecord.cancel_reason, lastRecord.cancel_detail)}` : ''
                }. Bilgi vermemi ister misiniz?`}
              />
            </div>
          )}
          {freeLands.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {freeLands.slice(0, 8).map(land => (
                <li key={land.id}>
                  <button
                    type="button"
                    onClick={() => openLand(land.id)}
                    className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm ring-1 ring-rose-100 hover:ring-rose-300"
                  >
                    {land.mahalle} · Ada {land.ada} / Parsel {land.parsel}
                  </button>
                </li>
              ))}
              {freeLands.length > 8 && <li className="self-center text-sm text-rose-700">+{freeLands.length - 8} arsa daha</li>}
            </ul>
          )}
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Arsa geçmişi */}
        <section className={`${CARD} p-5`}>
          <h2 className="font-semibold text-slate-800">Arsa geçmişi</h2>
          <p className="mt-0.5 text-sm text-slate-500">Bu müşterinin ilgilendiği tüm arsalar; boşa alınanlar da burada kalır.</p>
          {customer.records.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Henüz bir arsayla ilişkilendirilmedi.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {customer.records.map(record => {
                const outcome = OUTCOME_INFO[record.outcome];
                const { place, parcel } = splitLabel(record.land_label);
                const landId = record.land;
                return (
                  <li key={record.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                          <MapPin size={15} className="shrink-0 text-slate-400" />
                          {place}
                        </p>
                        {parcel && <p className="mt-0.5 pl-5 text-sm text-slate-500">{parcel}</p>}
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${outcome.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${outcome.dot}`} />
                        {outcome.label}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-slate-400">Ulaştığı aşama</dt>
                        <dd className="text-slate-700">{STAGE_TEXT[record.highest_status]}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Tarih</dt>
                        <dd className="text-slate-700">
                          {formatDate(record.started_at)}
                          {record.ended_at && ` – ${formatDate(record.ended_at)}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">{record.outcome === 'sold' ? 'Satış bedeli' : 'Kapora'}</dt>
                        <dd className="font-medium text-slate-800">
                          {formatCurrency(record.outcome === 'sold' ? record.sale_price : record.deposit_amount)}
                        </dd>
                      </div>
                    </dl>
                    {isAdmin && record.outcome === 'cancelled' && (
                      <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                        <span className="font-semibold">İptal nedeni:</span> {cancelReasonLabel(record.cancel_reason, record.cancel_detail)}
                        {record.cancel_note && <p className="mt-0.5 text-rose-700">“{record.cancel_note}”</p>}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound size={13} />
                        {record.representative_username ? `Temsilci: ${record.representative_username}` : 'Temsilci kaydı yok'}
                      </span>
                      <span className="flex flex-wrap items-center gap-4">
                      <WhatsAppButton
                        variant="link"
                        phone={customer.phone}
                        label="Bu arsa için yaz"
                        message={recordMessage(
                          customer.full_name,
                          record.outcome,
                          place,
                          parcel,
                          isAdmin ? record.cancel_reason : '',
                          isAdmin ? record.cancel_detail : '',
                        )}
                      />
                      {landId !== null ? (
                        <button
                          type="button"
                          onClick={() => openLand(landId)}
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Arsayı aç
                          {record.outcome === 'cancelled' && record.land_status && ` (şu an: ${statusLabels[record.land_status]})`}
                          <ArrowRight size={13} />
                        </button>
                      ) : (
                        <span>Arsa silinmiş</span>
                      )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Müşteri bilgileri */}
        <section className={`${CARD} p-5`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">Müşteri bilgileri</h2>
            {!editing && (
              <button type="button" onClick={startEditing} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Pencil size={14} />
                Düzenle
              </button>
            )}
          </div>

          {editing && form ? (
            <form
              onSubmit={event => {
                event.preventDefault();
                mutation.mutate(form);
              }}
              className="mt-4 space-y-3"
            >
              <label className="block text-sm font-medium text-slate-700">
                Ad soyad
                <input required maxLength={200} value={form.full_name} onChange={set('full_name')} className={INPUT} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Telefon
                <input value={form.phone} onChange={set('phone')} className={INPUT} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                TC / Vergi no
                <input inputMode="numeric" maxLength={11} value={form.national_id} onChange={set('national_id')} className={INPUT} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Bizi nereden buldu?
                <select value={form.source} onChange={set('source')} className={INPUT}>
                  <option value="">Belirtilmedi</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Notlar
                <textarea rows={4} value={form.notes} onChange={set('notes')} className={INPUT} />
              </label>
              <p className="text-xs text-slate-400">Ad ve telefon değişikliği bu müşteriye bağlı arsalara da yansır.</p>
              {mutation.isError && <p role="alert" className="text-sm text-red-600">{errorText(mutation.error)}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {mutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ['Ad soyad', customer.full_name],
                ['Telefon', customer.phone || '—'],
                ['TC / Vergi no', customer.national_id || '—'],
                ['Kaynak', customer.source ? SOURCE_LABELS[customer.source] : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-medium text-slate-800">{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-slate-500">Notlar</dt>
                <dd className={`mt-1 whitespace-pre-wrap ${customer.notes ? 'text-slate-700' : 'italic text-slate-400'}`}>
                  {customer.notes || 'Not eklenmemiş'}
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
