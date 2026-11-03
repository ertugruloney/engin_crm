import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Filter, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { getAuditLogs } from '../api';
import type { AuditLogFilters } from '../api';
import { ACTION_LABELS, TARGET_LABELS } from '../labels';

const STATUS_LABELS: Record<string, string> = {
  BOS: 'Satışa Uygun',
  REZERV: 'Rezerv',
  KAPORA_ALINDI: 'Kapora Alındı',
  TAPU: 'Tapu',
};

const FIELD_LABELS: Record<string, string> = {
  status: 'Durum',
  customer_name: 'Müşteri adı',
  customer_phone: 'Telefon',
  reservation_notes: 'Arsa notu',
  deposit_amount: 'Kapora tutarı',
  sales_representatives_can_view_reservation_details: 'Temsilci rezervasyon görünürlüğü',
  disabled_codes: 'Kapalı bildirim kodları',
};

const EMPTY_FILTERS: AuditLogFilters = {
  actor: '',
  action: '',
  dateFrom: '',
  dateTo: '',
};

const displayAuditValue = (field: string, value: unknown) => {
  if (field === 'status' && typeof value === 'string') return STATUS_LABELS[value] || value;
  if (value === null || value === '') return 'Boş';
  if (typeof value === 'boolean') return value ? 'Açık' : 'Kapalı';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
};

export default function AuditLogPage() {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilters>(() => ({
    ...EMPTY_FILTERS,
    actor: searchParams.get('actor') ?? '',
  }));
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['auditLogs', page, filters],
    queryFn: () => getAuditLogs(page, filters),
  });

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const updateFilter = (patch: Partial<AuditLogFilters>) => {
    setFilters(current => ({ ...current, ...patch }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  if (isLoading) return <div className="flex-1 text-center text-slate-500">Denetim kayıtları yükleniyor...</div>;
  if (isError) return <div role="alert" className="text-red-600">Denetim kayıtları yüklenemedi: {error.message}</div>;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <div className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-800">Denetim Kayıtları</h1>
          <p className="mt-1 text-slate-500">Tüm kullanıcıların oturumları ve arsalarda yapılan değişiklikler.</p>
        </div>
        <span className="text-sm text-slate-500">{data?.count ?? 0} kayıt</span>
      </div>

      <section aria-label="Denetim kaydı filtreleri" className="mb-5 shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Filter size={16} className="text-slate-500" />
            Kayıtları filtrele
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <RotateCcw size={13} />
              Filtreleri temizle
            </button>
          )}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}>
          <label className="text-xs font-medium text-slate-600">
            Kişi
            <select
              value={filters.actor ?? ''}
              onChange={event => updateFilter({ actor: event.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Tüm kişiler</option>
              {(data?.actors ?? []).map(actor => (
                <option key={actor} value={actor}>{actor}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            İşlem
            <select
              value={filters.action ?? ''}
              onChange={event => updateFilter({ action: event.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Tüm işlemler</option>
              {(data?.actions ?? []).map(action => (
                <option key={action} value={action}>{ACTION_LABELS[action] ?? action}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Başlangıç tarihi
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={event => updateFilter({ dateFrom: event.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Bitiş tarihi
            <input
              type="date"
              value={filters.dateTo ?? ''}
              onChange={event => updateFilter({ dateTo: event.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            />
          </label>
        </div>
      </section>

      <section aria-label="Yönetici işlem kayıtları" className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold text-slate-800">İşlem geçmişi</h2>
          <span className="text-sm text-slate-500">{data?.count ?? 0} kayıt</span>
        </div>
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {['Tarih', 'Kullanıcı', 'İşlem', 'Kayıt', 'Değişiklikler'].map(label => (
                <th key={label} className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-300">
            {data?.results.map(entry => (
              <tr key={entry.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {new Date(entry.created_at).toLocaleString('tr-TR')}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{entry.actor_username}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                  {entry.action === 'land.status_changed' && entry.changes.status ? (
                    <>
                      Durum değişti:{' '}
                      {displayAuditValue('status', (entry.changes.status as { old?: unknown }).old)}
                      {' → '}
                      {displayAuditValue('status', (entry.changes.status as { new?: unknown }).new)}
                    </>
                  ) : (
                    ACTION_LABELS[entry.action] || entry.action
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                  {typeof entry.changes.land_label === 'string'
                    ? entry.changes.land_label
                    : TARGET_LABELS[entry.target_type] || entry.target_type}
                  {entry.target_id ? ` (#${entry.target_id})` : ''}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {Object.keys(entry.changes).some(field => field !== 'land_label' && field !== 'reservation_date') ? (
                    <details>
                      <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700">Ayrıntıları gör</summary>
                      <dl className="mt-2 max-w-xl space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                        {Object.entries(entry.changes)
                          .filter(([field]) => field !== 'land_label' && field !== 'reservation_date')
                          .map(([field, value]) => {
                            const change = value && typeof value === 'object' && !Array.isArray(value)
                              ? value as { old?: unknown; new?: unknown }
                              : null;
                            return (
                              <div key={field}>
                                <dt className="font-semibold text-slate-700">{FIELD_LABELS[field] || field}</dt>
                                <dd className="text-slate-600">
                                  {change && ('old' in change || 'new' in change)
                                    ? `${displayAuditValue(field, change.old)} → ${displayAuditValue(field, change.new)}`
                                    : JSON.stringify(value)}
                                </dd>
                              </div>
                            );
                          })}
                      </dl>
                    </details>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {data?.results.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                  {hasActiveFilters
                    ? 'Filtre kriterlerinize uygun kayıt bulunamadı.'
                    : 'Henüz işlem kaydı bulunmuyor.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-4 flex shrink-0 items-center justify-between">
        <span className="text-sm text-slate-500">Sayfa {page}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage(current => Math.max(1, current - 1))}
            disabled={!data?.previous}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={16} />
            Önceki
          </button>
          <button
            type="button"
            onClick={() => setPage(current => current + 1)}
            disabled={!data?.next}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sonraki
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
