import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Contact, Download, Flame, MapPin, Plus, Search, X } from 'lucide-react';
import * as xlsx from 'xlsx';
import { createCustomer, getCancelReasons, getCustomers, getLands } from '../api';
import type { Customer, CustomerInput } from '../api';
import { SOURCE_LABELS, cancelReasonLabel, formatCurrency, formatDate, initials, isHotLead, regionKey } from '../customerDisplay';
import WhatsAppButton from './WhatsAppButton';

type Segment = 'all' | 'buyers' | 'active' | 'hot';

const SEGMENTS: { value: Segment; label: string; hint: string; dot: string; test: (customer: Customer) => boolean }[] = [
  { value: 'all', label: 'Tüm müşteriler', hint: 'Sistemdeki herkes', dot: 'bg-slate-700', test: () => true },
  { value: 'buyers', label: 'Satın alanlar', hint: 'En az bir arsanın tapusu verilen', dot: 'bg-emerald-500', test: customer => customer.purchased_count > 0 },
  { value: 'active', label: 'Süreci devam edenler', hint: 'Rezerv veya kapora aşamasında', dot: 'bg-amber-500', test: customer => customer.active_count > 0 },
  { value: 'hot', label: 'İptal edilenler', hint: 'Rezervasyonu bozmuş, şu an süreci yok', dot: 'bg-rose-500', test: isHotLead },
];

const CARD = 'rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,35,95,0.06)] ring-1 ring-slate-100';
const INPUT =
  'mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

const normalize = (value: string) => value.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');

const errorText = (error: unknown) => {
  if (isAxiosError<Record<string, unknown>>(error) && error.response?.data) {
    const messages = Object.values(error.response.data).flatMap(value => (Array.isArray(value) ? value : [value]));
    const text = messages.filter((value): value is string => typeof value === 'string').join(' ');
    if (text) return text;
  }
  return error instanceof Error ? error.message : 'Kaydedilemedi.';
};

const EMPTY_INPUT: CustomerInput = { full_name: '', phone: '', national_id: '', source: '', notes: '' };

function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (customer: Customer) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CustomerInput>(EMPTY_INPUT);
  const mutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: async customer => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      onCreated(customer);
    },
  });
  const set = (field: keyof CustomerInput) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [field]: event.target.value }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !mutation.isPending) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-customer-title"
        onSubmit={event => {
          event.preventDefault();
          mutation.mutate(form);
        }}
        className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="new-customer-title" className="text-xl font-bold text-slate-900">Yeni müşteri</h2>
            <p className="mt-1 text-sm text-slate-500">Henüz arsa ayırtmamış bir müşteriyi önceden kaydedin.</p>
          </div>
          <button type="button" aria-label="Kapat" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Ad soyad
          <input required maxLength={200} value={form.full_name} onChange={set('full_name')} className={INPUT} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Telefon
            <input value={form.phone} onChange={set('phone')} placeholder="05xx xxx xx xx" className={INPUT} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            TC / Vergi no <span className="font-normal text-slate-400">(isteğe bağlı)</span>
            <input inputMode="numeric" maxLength={11} value={form.national_id} onChange={set('national_id')} className={INPUT} />
          </label>
        </div>
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
          <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Örn. Gölbaşı'nda 500 m² civarı arıyor" className={INPUT} />
        </label>
        {mutation.isError && <p role="alert" className="text-sm text-red-600">{errorText(mutation.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Kaydediliyor...' : 'Müşteriyi kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CustomersPage({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const segmentParam = params.get('grup');
  const segment: Segment = SEGMENTS.some(item => item.value === segmentParam) ? (segmentParam as Segment) : 'all';
  const search = params.get('ara') ?? '';
  const source = params.get('kaynak') ?? '';
  const [showNew, setShowNew] = useState(false);

  const updateParams = (patch: Record<string, string | null>) =>
    setParams(
      current => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: getCustomers });
  const landsQuery = useQuery({ queryKey: ['lands'], queryFn: getLands });
  const cancelReasonsQuery = useQuery({
    queryKey: ['customers', 'cancelReasons'],
    queryFn: getCancelReasons,
    enabled: isAdmin,
  });
  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);

  // İlçe bazında şu an boşta olan arsa sayısı (yeniden aranacak müşteriler için).
  const availableByRegion = useMemo(() => {
    const counts = new Map<string, number>();
    for (const land of landsQuery.data ?? []) {
      if (land.status !== 'BOS') continue;
      const key = regionKey(land.il, land.ilce);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [landsQuery.data]);

  const visible = useMemo(() => {
    const query = normalize(search);
    const test = SEGMENTS.find(item => item.value === segment)!.test;
    return customers
      .filter(
        customer =>
          test(customer) &&
          (!source || customer.source === source) &&
          (!query ||
            normalize(customer.full_name).includes(query) ||
            customer.phone.replace(/\D/g, '').includes(query.replace(/\D/g, '') || '\u0000') ||
            customer.national_id.includes(query)),
      )
      .sort((a, b) => (b.last_activity_at ?? b.created_at).localeCompare(a.last_activity_at ?? a.created_at));
  }, [customers, segment, search, source]);

  const exportCustomers = () => {
    const rows = visible.map(customer => ({
      'Ad soyad': customer.full_name,
      Telefon: customer.phone,
      'TC / Vergi no': customer.national_id,
      Kaynak: customer.source ? SOURCE_LABELS[customer.source] : '',
      'Satın aldığı arsa': customer.purchased_count,
      'Toplam alım (₺)': Number(customer.purchased_total ?? 0),
      'Devam eden': customer.active_count,
      'İptal ettiği': customer.cancelled_count,
      'Son bölge': [customer.last_il, customer.last_ilce].filter(Boolean).join(' / '),
      'Son işlem': formatDate(customer.last_activity_at),
      Notlar: customer.notes.startsWith('[DEMO]') ? '' : customer.notes,
    }));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Müşteriler');
    xlsx.writeFile(workbook, 'musteriler.xlsx');
  };

  if (customersQuery.isLoading) return <div className="flex-1 py-12 text-center text-slate-500">Müşteriler yükleniyor...</div>;
  if (customersQuery.isError) {
    return <div role="alert" className="text-red-600">Müşteriler yüklenemedi: {customersQuery.error.message}</div>;
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            <Contact size={28} className="text-blue-600" />
            Müşteriler
          </h1>
          <p className="mt-2 text-slate-500">
            Rezervasyon yapan, satın alan ve vazgeçen tüm müşterileriniz; arsa boşa alınsa da burada kalır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={exportCustomers}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              <Download size={16} />
              Excel'e aktar
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={18} />
            Yeni müşteri
          </button>
        </div>
      </div>

      <section aria-label="Müşteri grupları" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {SEGMENTS.map(item => {
          const active = segment === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => updateParams({ grup: item.value === 'all' ? null : item.value })}
              className={`${CARD} px-4 py-3 text-left transition ${active ? 'ring-2 ring-blue-500' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                {item.label}
              </span>
              <span className="mt-1 block text-2xl font-bold text-slate-900">{customers.filter(item.test).length}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">{item.hint}</span>
            </button>
          );
        })}
      </section>

      {segment === 'hot' && (
        <p className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <Flame size={18} className="mt-0.5 shrink-0" />
          Bu müşteriler bir arsayı ayırtıp vazgeçti ve şu an açık süreçleri yok. Son ilgilendikleri bölgede boş arsa
          varsa yanında yazar; aramak için en sıcak adaylar bunlardır.
        </p>
      )}

      {isAdmin && segment === 'hot' && cancelReasonsQuery.data && cancelReasonsQuery.data.total > 0 && (
        <section className={`${CARD} p-5`}>
          <h2 className="font-semibold text-slate-800">Müşteriler neden vazgeçiyor?</h2>
          <p className="mt-0.5 text-sm text-slate-500">Bugüne kadarki {cancelReasonsQuery.data.total} iptalin nedenlere göre dağılımı.</p>
          <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {cancelReasonsQuery.data.results.map(row => {
              const share = Math.round((row.count / cancelReasonsQuery.data.total) * 100);
              return (
                <li key={row.reason || 'none'}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-700">{row.label}</span>
                    <span className="shrink-0 text-slate-500">
                      <span className="font-semibold text-slate-800">{row.count}</span> · %{share}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${share}%` }} />
                  </div>
                  {row.details.length > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      {row.details.map(item => `${item.label} (${item.count})`).join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className={`${CARD} flex flex-wrap items-end gap-3 p-4`}>
        <label className="min-w-[16rem] flex-1 text-xs font-medium text-slate-500">
          Ara
          <span className="relative mt-1 block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={event => updateParams({ ara: event.target.value || null })}
              placeholder="Ad, telefon veya TC / vergi no"
              className={`${INPUT} mt-0 pl-9`}
            />
          </span>
        </label>
        <label className="text-xs font-medium text-slate-500">
          Kaynak
          <select value={source} onChange={event => updateParams({ kaynak: event.target.value || null })} className={INPUT}>
            <option value="">Tüm kaynaklar</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">{SEGMENTS.find(item => item.value === segment)!.label}</h2>
          <span className="text-sm text-slate-500">{visible.length} müşteri</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-14 text-center text-slate-500">Bu filtrelere uyan müşteri yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500">
                  {['Müşteri', 'Durum', 'Toplam alım', 'Son bölge', 'Son işlem', ''].map(label => (
                    <th key={label} className="border-b border-slate-100 px-4 py-3">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(customer => {
                  const hot = isHotLead(customer);
                  const freeNearby = hot ? availableByRegion.get(regionKey(customer.last_il, customer.last_ilce)) ?? 0 : 0;
                  return (
                    <tr
                      key={customer.id}
                      tabIndex={0}
                      onClick={() => navigate(`/customers/${customer.id}`)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') navigate(`/customers/${customer.id}`);
                      }}
                      className="group cursor-pointer transition-colors hover:bg-blue-50/50 focus:outline-none focus-visible:bg-blue-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                            {initials(customer.full_name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{customer.full_name}</p>
                            <p className="truncate text-xs text-slate-500">
                              {customer.phone || 'Telefon yok'}
                              {customer.source && ` · ${SOURCE_LABELS[customer.source]}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {customer.purchased_count > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                              {customer.purchased_count} arsa aldı
                            </span>
                          )}
                          {customer.active_count > 0 && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                              {customer.active_count} süreç
                            </span>
                          )}
                          {customer.cancelled_count > 0 && (
                            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                              {customer.cancelled_count} iptal
                            </span>
                          )}
                          {customer.purchased_count + customer.active_count + customer.cancelled_count === 0 && (
                            <span className="text-xs text-slate-400">Henüz arsa yok</span>
                          )}
                        </div>
                        {isAdmin && customer.cancelled_count > 0 && customer.last_cancel_reason !== null && (
                          <p className="mt-1 text-xs text-slate-500">Son iptal: {cancelReasonLabel(customer.last_cancel_reason, customer.last_cancel_detail)}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">
                        {customer.purchased_count > 0 ? formatCurrency(customer.purchased_total) : <span className="font-normal text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {customer.last_il ? (
                          <>
                            <span className="flex items-center gap-1 text-slate-700">
                              <MapPin size={13} className="text-slate-400" />
                              {customer.last_il} / {customer.last_ilce}
                            </span>
                            {hot && freeNearby > 0 && (
                              <span className="mt-1 inline-flex rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                                Bu ilçede {freeNearby} boş arsa var
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(customer.last_activity_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <WhatsAppButton
                            variant="icon"
                            phone={customer.phone}
                            label={`${customer.full_name} ile WhatsApp'tan yazış`}
                            message={
                              hot && freeNearby > 0
                                ? `Merhaba ${customer.full_name}, daha önce ilgilendiğiniz ${customer.last_il} / ${customer.last_ilce} bölgesinde şu an ${freeNearby} boş arsamız var. Bilgi vermemi ister misiniz?`
                                : `Merhaba ${customer.full_name}, Engin Arsa'dan yazıyorum.`
                            }
                          />
                          <ChevronRight size={18} className="text-slate-300 transition-colors group-hover:text-blue-500" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showNew && (
        <NewCustomerModal
          onClose={() => setShowNew(false)}
          onCreated={customer => {
            setShowNew(false);
            navigate(`/customers/${customer.id}`);
          }}
        />
      )}
    </div>
  );
}
