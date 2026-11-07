import { useQuery } from '@tanstack/react-query';
import { Clock3, History } from 'lucide-react';
import { getLandHistory } from '../api';
import type { AuditLogEntry } from '../api';
import { ACTION_LABELS } from '../labels';
import { statusLabels } from '../types';
import type { LandStatus } from '../types';

const FIELD_LABELS: Record<string, string> = {
  status: 'Durum',
  customer_name: 'Müşteri adı',
  customer_phone: 'Telefon',
  cancel_reason: 'İptal nedeni',
  cancel_note: 'İptal açıklaması',
  latitude: 'Enlem',
  longitude: 'Boylam',
  parcel_query_url: 'Parsel Sorgu linki',
  reservation_notes: 'Arsa notu',
  deposit_amount: 'Kapora tutarı',
};

const formatValue = (field: string, value: unknown) => {
  if (value === null || value === '') return 'Boş';
  if (field === 'status' && typeof value === 'string') {
    return statusLabels[value as LandStatus] || value;
  }
  if (typeof value === 'boolean') return value ? 'Açık' : 'Kapalı';
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
};

export default function LandHistory({ landId }: { landId: number }) {
  const { data: history = [], isLoading, isError, error } = useQuery({
    queryKey: ['landHistory', landId],
    queryFn: () => getLandHistory(landId),
  });

  return (
    <section aria-label="Arsa işlem geçmişi" className="border-t border-slate-100 pt-6">
      <div className="mb-4 flex items-center gap-2">
        <History size={17} className="text-blue-600" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600">İşlem geçmişi</h3>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Geçmiş yükleniyor...</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-red-600">İşlem geçmişi yüklenemedi: {error.message}</p>
      ) : history.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
          Bu arsa için kayıtlı işlem geçmişi yok.
        </p>
      ) : (
        <ol className="space-y-3">
          {history.map((event: AuditLogEntry) => {
            const changes = Object.entries(event.changes)
              .filter(([field]) => field !== 'land_label' && field !== 'created' && field !== 'reservation_date');
            return (
              <li key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800">
                    {ACTION_LABELS[event.action] || event.action}
                  </p>
                  <time className="shrink-0 text-xs text-slate-500">
                    {new Date(event.created_at).toLocaleString('tr-TR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <Clock3 size={12} />
                  {event.actor_username}
                </p>
                {changes.length > 0 && (
                  <dl className="mt-3 space-y-2 border-t border-slate-200 pt-2">
                    {changes.map(([field, value]) => {
                      const change = value && typeof value === 'object' && !Array.isArray(value)
                        ? value as Record<string, unknown>
                        : null;
                      return (
                        <div key={field} className="text-xs">
                          <dt className="font-semibold text-slate-600">{FIELD_LABELS[field] || field}</dt>
                          <dd className="mt-0.5 text-slate-700">
                            {change && ('old' in change || 'new' in change)
                              ? `${formatValue(field, change.old)} → ${formatValue(field, change.new)}`
                              : 'Güncellendi'}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
