import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { getAuditCalendar } from '../api';
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

const displayAuditValue = (field: string, value: unknown) => {
  if (field === 'status' && typeof value === 'string') return STATUS_LABELS[value] || value;
  if (value === null || value === '') return 'Boş';
  if (typeof value === 'boolean') return value ? 'Açık' : 'Kapalı';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
};

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  let startOffset = firstDay.getDay();
  startOffset = startOffset === 0 ? 6 : startOffset - 1;

  const days: Array<{ date: Date | null; key: string }> = [];
  for (let i = 0; i < startOffset; i++) {
    days.push({ date: null, key: `empty-${i}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), key: `${year}-${month}-${d}` });
  }
  return days;
}

export default function ActivityCalendarPage() {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(today.toISOString().split('T')[0]);
  const [filters] = useState<AuditLogFilters>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['auditCalendar', filters],
    queryFn: () => getAuditCalendar(filters),
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    data?.results?.forEach(day => {
      map.set(day.date, day.events);
    });
    return map;
  }, [data]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthDays = getMonthDays(year, month);
  const monthLabel = currentDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) || [] : [];

  const goPrev = () => setCurrentDate(new Date(year, month - 1, 1));
  const goNext = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today.toISOString().split('T')[0]);
  };

  if (isLoading) return <div className="flex-1 text-center text-slate-500">Takvim yükleniyor...</div>;
  if (isError) return <div role="alert" className="text-red-600">Takvim verileri yüklenemedi.</div>;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <div className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <CalendarIcon size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">İşlem Takvimi</h1>
            <p className="mt-1 text-slate-500">Arsa işlemlerinin tarih bazlı görünümü</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={goToday} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Bugün</button>
          <button onClick={goPrev} className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"><ChevronLeft size={18} /></button>
          <button onClick={goNext} className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"><ChevronRight size={18} /></button>
          <span className="ml-1 text-base font-semibold capitalize text-slate-800 sm:ml-2 sm:text-lg">{monthLabel}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <section className="flex min-h-[360px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:min-h-[480px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map(day => (
              <div key={day} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</div>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7 grid-rows-6">
            {monthDays.map(({ date, key }) => {
              if (!date) return <div key={key} className="border-b border-r border-slate-100 bg-slate-50/40" />;
              const iso = date.toISOString().split('T')[0];
              const events = eventsByDate.get(iso) || [];
              const isToday = date.toDateString() === today.toDateString();
              const isSelected = selectedDate === iso;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(iso)}
                  className={`relative flex min-w-0 flex-col border-b border-r border-slate-100 p-1 text-left transition-colors hover:bg-blue-50/40 sm:p-2 ${isSelected ? 'bg-blue-50/70' : ''}`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs sm:h-7 sm:w-7 sm:text-sm ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{date.getDate()}</span>
                  <div className="mt-1 flex flex-wrap gap-1 sm:mt-2">
                    {events.slice(0, 3).map((ev: any, idx: number) => (
                      <span key={idx} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                        {ACTION_LABELS[ev.action]?.split(' ')[0] || ev.action}
                      </span>
                    ))}
                    {events.length > 3 && <span className="text-[10px] text-slate-400">+{events.length - 3}</span>}
                  </div>
                  {events.length > 0 && <span className="absolute bottom-2 right-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{events.length}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold text-slate-800">
              {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }) : 'Bir gün seçin'}
            </h2>
            <p className="text-sm text-slate-500">{selectedEvents.length} işlem</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {selectedEvents.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Bu tarihte işlem kaydı yok</div>
            ) : (
              <ul className="divide-y-2 divide-slate-300">
                {selectedEvents.map((ev: any) => {
                  const time = new Date(ev.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                  const label = ev.action === 'land.status_changed' && ev.changes && typeof ev.changes === 'object' && 'status' in ev.changes
                    ? `Durum: ${displayAuditValue('status', (ev.changes.status as any).old)} → ${displayAuditValue('status', (ev.changes.status as any).new)}`
                    : ACTION_LABELS[ev.action] || ev.action;
                  const target = typeof ev.changes?.land_label === 'string' ? (ev.changes.land_label as string) : (TARGET_LABELS[ev.target_type] || ev.target_type);
                  return (
                    <li key={ev.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-800">{label}</p>
                          <p className="mt-0.5 text-sm text-slate-600">{target}{ev.target_id ? ` (#${ev.target_id})` : ''}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{time}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{ev.actor_username}</span>
                      </div>
                      {ev.changes && Object.keys(ev.changes).filter(k => k !== 'land_label' && k !== 'reservation_date').length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-blue-600">Detaylar</summary>
                          <dl className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
                            {Object.entries(ev.changes).filter(([k]) => k !== 'land_label' && k !== 'reservation_date').map(([field, value]: any) => {
                              const change = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
                              return (
                                <div key={field}>
                                  <dt className="font-semibold text-slate-700">{FIELD_LABELS[field] || field}</dt>
                                  <dd className="text-slate-600">{change && ('old' in change || 'new' in change) ? `${displayAuditValue(field, change.old)} → ${displayAuditValue(field, change.new)}` : JSON.stringify(value)}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
