import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getAuditCalendar } from '../api';
import type { CalendarEvent } from '../api';
import { ACTION_LABELS } from '../labels';
import { statusLabels } from '../types';
import type { LandStatus } from '../types';

// ---------------------------------------------------------------------------
// İşlem türleri: her kayıt tek bir türe düşer ve takvimde o türün rengiyle görünür.
// ---------------------------------------------------------------------------

type Category = 'reservation' | 'deposit' | 'sale' | 'created' | 'updated' | 'other';

const CATEGORIES: Record<Category, { label: string; short: string; icon: LucideIcon; pill: string; dot: string; iconBox: string }> = {
  reservation: {
    label: 'Rezervasyon',
    short: 'Rezerv',
    icon: UserRound,
    pill: 'bg-amber-50 text-amber-800 ring-amber-200',
    dot: 'bg-amber-500',
    iconBox: 'bg-amber-100 text-amber-700',
  },
  deposit: {
    label: 'Kapora',
    short: 'Kapora',
    icon: Wallet,
    pill: 'bg-blue-50 text-blue-800 ring-blue-200',
    dot: 'bg-blue-500',
    iconBox: 'bg-blue-100 text-blue-700',
  },
  sale: {
    label: 'Satış (Tapu)',
    short: 'Satış',
    icon: Check,
    pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-500',
    iconBox: 'bg-emerald-100 text-emerald-700',
  },
  created: {
    label: 'Yeni arsa',
    short: 'Yeni',
    icon: Plus,
    pill: 'bg-violet-50 text-violet-800 ring-violet-200',
    dot: 'bg-violet-500',
    iconBox: 'bg-violet-100 text-violet-700',
  },
  updated: {
    label: 'Güncelleme',
    short: 'Güncel.',
    icon: Pencil,
    pill: 'bg-sky-50 text-sky-800 ring-sky-200',
    dot: 'bg-sky-500',
    iconBox: 'bg-sky-100 text-sky-700',
  },
  other: {
    label: 'Diğer',
    short: 'Diğer',
    icon: CircleDot,
    pill: 'bg-slate-100 text-slate-700 ring-slate-200',
    dot: 'bg-slate-400',
    iconBox: 'bg-slate-100 text-slate-600',
  },
};
const CATEGORY_ORDER: Category[] = ['reservation', 'deposit', 'sale', 'created', 'updated', 'other'];

const statusChange = (event: CalendarEvent) => {
  const status = event.changes.status;
  if (!status || typeof status !== 'object') return null;
  const { old: from, new: to } = status as { old?: LandStatus; new?: LandStatus };
  return to ? { from: from ?? null, to } : null;
};

const categoryOf = (event: CalendarEvent): Category => {
  const change = event.action === 'land.status_changed' ? statusChange(event) : null;
  if (change?.to === 'REZERV') return 'reservation';
  if (change?.to === 'KAPORA_ALINDI') return 'deposit';
  if (change?.to === 'TAPU') return 'sale';
  if (event.action === 'land.created' || event.action === 'land.bulk_created') return 'created';
  if (event.action === 'land.updated') return 'updated';
  return 'other';
};

// Ajandada görünen başlık.
const titleOf = (event: CalendarEvent, category: Category) => {
  if (category === 'reservation') return 'Rezervasyon yapıldı';
  if (category === 'deposit') return 'Kapora alındı';
  if (category === 'sale') return 'Satış tamamlandı, tapu verildi';
  if (event.action === 'land.status_changed' && statusChange(event)?.to === 'BOS') return 'Arsa yeniden satışa açıldı';
  if (event.action === 'land.bulk_created') {
    const count = typeof event.changes.count === 'number' ? event.changes.count : null;
    return count ? `${count} arsa toplu eklendi` : 'Toplu arsa eklendi';
  }
  if (event.action === 'land.created') return 'Yeni arsa eklendi';
  if (event.action === 'land.updated') return 'Arsa bilgileri güncellendi';
  if (event.action === 'land.deleted') return 'Arsa silindi';
  return ACTION_LABELS[event.action] ?? event.action;
};

// "İl, İlçe, Mahalle, Ada X / Parsel Y" etiketini iki satıra böler.
const describeLand = (event: CalendarEvent) => {
  const label = typeof event.changes.land_label === 'string' ? event.changes.land_label : '';
  const parts = label.split(',').map(part => part.trim()).filter(Boolean);
  if (event.action === 'land.bulk_created' || parts.length < 4) return { place: label || null, parcel: null };
  const [il, ilce, mahalle, ...rest] = parts;
  return { place: `${il} / ${ilce} · ${mahalle}`, parcel: rest.join(', ') };
};

// ---------------------------------------------------------------------------
// Değişikliklerin okunur gösterimi
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'Müşteri',
  customer_phone: 'Telefon',
  reservation_notes: 'Not',
  reservation_date: 'Rezervasyon tarihi',
  deposit_amount: 'Kapora tutarı',
  sale_price: 'Satış bedeli',
  installment_plan: 'Taksit planı',
  title_deed_image: 'Tapu görseli',
  is_reserved: 'Rezerve',
  il: 'İl',
  ilce: 'İlçe',
  mahalle: 'Mahalle',
  ada: 'Ada',
  parsel: 'Parsel',
};
const HIDDEN_FIELDS = new Set(['land_label', 'status', 'demo', 'created', 'deleted', 'lands', 'count']);

const formatCurrency = (value: unknown) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(value));

const formatValue = (field: string, value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'deposit_amount' || field === 'sale_price') return formatCurrency(value);
  if (field === 'installment_plan') return Array.isArray(value) ? (value.length ? `${value.length} taksit` : 'Yok') : '—';
  if (field === 'title_deed_image') return 'Yüklendi';
  if (field === 'reservation_date' && typeof value === 'string') return parseLocalDate(value.slice(0, 10)).toLocaleDateString('tr-TR');
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
};

const fieldChanges = (event: CalendarEvent) =>
  Object.entries(event.changes)
    .filter(([field, value]) => !HIDDEN_FIELDS.has(field) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([field, value]) => {
      const change = value as { old?: unknown; new?: unknown };
      return { field, label: FIELD_LABELS[field] ?? field, from: formatValue(field, change.old), to: formatValue(field, change.new) };
    })
    .filter(change => change.from !== change.to);

// ---------------------------------------------------------------------------
// Tarih yardımcıları (her şey yerel saate göre)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const toLocalISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function parseLocalDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

// Pazartesiyle başlayan, ayı tam haftalarla kaplayan gün listesi.
const getGridDays = (year: number, month: number) => {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  const start = addDays(first, -offset);
  return Array.from({ length: cellCount }, (_, index) => addDays(start, index));
};

const initials = (name: string) => {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toLocaleUpperCase('tr-TR');
};

const CARD = 'rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,35,95,0.06)] ring-1 ring-slate-100';

// ---------------------------------------------------------------------------
// Sayfa
// ---------------------------------------------------------------------------

export default function ActivityCalendarPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const todayIso = toLocalISODate(new Date());

  // Görüntülenen ay ve seçili gün adreste tutulur; arsa detayından geri dönünce aynı yere gelinir.
  const monthParam = params.get('ay');
  const [year, month] = /^\d{4}-\d{2}$/.test(monthParam ?? '')
    ? [Number(monthParam!.slice(0, 4)), Number(monthParam!.slice(5, 7)) - 1]
    : [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];
  const selectedDate = params.get('gun') ?? todayIso;
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [actor, setActor] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const setView = (nextYear: number, nextMonth: number, day?: string) => {
    const normalized = new Date(nextYear, nextMonth, 1);
    const monthKey = `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, '0')}`;
    setParams(
      current => {
        const next = new URLSearchParams(current);
        next.set('ay', monthKey);
        if (day) next.set('gun', day);
        return next;
      },
      { replace: true },
    );
  };
  const selectDay = (iso: string) => {
    const date = parseLocalDate(iso);
    setView(date.getFullYear(), date.getMonth(), iso);
  };

  const gridDays = useMemo(() => getGridDays(year, month), [year, month]);
  // Sunucu günleri UTC'ye göre süzdüğü için aralık iki yana birer gün genişletilir; gruplama yerel saatle yapılır.
  const range = useMemo(
    () => ({
      dateFrom: toLocalISODate(addDays(gridDays[0], -1)),
      dateTo: toLocalISODate(addDays(gridDays[gridDays.length - 1], 1)),
    }),
    [gridDays],
  );

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['auditCalendar', range],
    queryFn: () => getAuditCalendar(range),
    placeholderData: keepPreviousData,
  });

  const allEvents = useMemo(
    () =>
      (data?.results ?? [])
        .flatMap(day => day.events)
        .map(event => ({ event, category: categoryOf(event), day: toLocalISODate(new Date(event.created_at)) })),
    [data],
  );

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEvents = allEvents.filter(item => item.day.startsWith(monthPrefix) && (!actor || item.event.actor_username === actor));
  const actors = [...new Set(allEvents.map(item => item.event.actor_username))].sort((a, b) => a.localeCompare(b, 'tr'));
  const categoryCounts = Object.fromEntries(
    CATEGORY_ORDER.map(item => [item, monthEvents.filter(entry => entry.category === item).length]),
  ) as Record<Category, number>;

  const visibleEvents = allEvents.filter(
    item => (category === 'all' || item.category === category) && (!actor || item.event.actor_username === actor),
  );
  const eventsByDay = new Map<string, typeof visibleEvents>();
  for (const item of visibleEvents) {
    const list = eventsByDay.get(item.day) ?? [];
    list.push(item);
    eventsByDay.set(item.day, list);
  }
  const dayEvents = [...(eventsByDay.get(selectedDate) ?? [])].sort(
    (a, b) => new Date(a.event.created_at).getTime() - new Date(b.event.created_at).getTime(),
  );

  const monthLabel = new Date(year, month, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const selectedLabel = parseLocalDate(selectedDate).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const openLand = (landId: string) =>
    navigate(`/land/${landId}`, { state: { from: `/activity-calendar?${params.toString()}` } });

  const toggleExpanded = (id: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) return <div className="flex-1 py-12 text-center text-slate-500">Takvim yükleniyor...</div>;
  if (isError) return <div role="alert" className="text-red-600">Takvim verileri yüklenemedi.</div>;

  const filterChips: { value: Category | 'all'; label: string; dot: string; count: number }[] = [
    { value: 'all', label: 'Tümü', dot: 'bg-slate-800', count: monthEvents.length },
    ...CATEGORY_ORDER.map(item => ({ value: item, label: CATEGORIES[item].label, dot: CATEGORIES[item].dot, count: categoryCounts[item] })),
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5">
      {/* Başlık + ay gezinme */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            <CalendarDays size={28} className="text-blue-600" />
            İşlem Takvimi
          </h1>
          <p className="mt-2 text-slate-500">Rezervasyon, kapora, satış ve arsa işlemlerini gün gün takip edin.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => selectDay(todayIso)}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            Bugün
          </button>
          <div className="flex items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              aria-label="Önceki ay"
              onClick={() => setView(year, month - 1)}
              className="rounded-l-xl p-2 text-slate-600 transition-colors hover:bg-slate-50"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-[9.5rem] text-center text-sm font-semibold capitalize text-slate-800">{monthLabel}</span>
            <button
              type="button"
              aria-label="Sonraki ay"
              onClick={() => setView(year, month + 1)}
              className="rounded-r-xl p-2 text-slate-600 transition-colors hover:bg-slate-50"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Filtreler: işlem türü (ayın sayılarıyla) ve kişi */}
      <div className={`${CARD} flex flex-wrap items-center gap-2 p-3`}>
        {filterChips.map(chip => (
          <button
            key={chip.value}
            type="button"
            aria-pressed={category === chip.value}
            onClick={() => setCategory(chip.value)}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              category === chip.value ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${category === chip.value && chip.value === 'all' ? 'bg-white' : chip.dot}`} />
            {chip.label}
            <span className={category === chip.value ? 'text-white/70' : 'text-slate-400'}>{chip.count}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          Kişi
          <select
            value={actor}
            onChange={event => setActor(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
          >
            <option value="">Herkes</option>
            {actors.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        {(category !== 'all' || actor) && (
          <button
            type="button"
            onClick={() => {
              setCategory('all');
              setActor('');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <RotateCcw size={14} />
            Temizle
          </button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Ay görünümü */}
        <section className={`${CARD} relative flex min-h-[420px] flex-col overflow-hidden`} aria-label={`${monthLabel} takvimi`}>
          {isFetching && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-blue-500" />}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {WEEKDAYS.map((day, index) => (
              <div
                key={day}
                className={`py-2.5 text-center text-xs font-semibold ${index >= 5 ? 'text-slate-400' : 'text-slate-500'}`}
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7" style={{ gridAutoRows: 'minmax(5.5rem, 1fr)' }}>
            {gridDays.map((date, index) => {
              const iso = toLocalISODate(date);
              const inMonth = date.getMonth() === month;
              const items = eventsByDay.get(iso) ?? [];
              const isToday = iso === todayIso;
              const isSelected = iso === selectedDate;
              const isWeekend = index % 7 >= 5;
              const counts = CATEGORY_ORDER.map(item => ({ item, count: items.filter(entry => entry.category === item).length })).filter(
                entry => entry.count > 0,
              );
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => selectDay(iso)}
                  aria-pressed={isSelected}
                  aria-label={`${date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}, ${items.length} işlem`}
                  className={`relative flex min-w-0 flex-col gap-1 border-b border-r border-slate-100 p-1.5 text-left transition-colors sm:p-2 ${
                    isWeekend ? 'bg-slate-50/60' : 'bg-white'
                  } ${isSelected ? 'z-10 ring-2 ring-inset ring-blue-500' : 'hover:bg-blue-50/50'}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-blue-600 font-semibold text-white'
                          : inMonth
                            ? 'font-medium text-slate-800'
                            : 'text-slate-300'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {items.length > 0 && (
                      <span className={`text-xs font-semibold ${inMonth ? 'text-slate-400' : 'text-slate-300'}`}>{items.length}</span>
                    )}
                  </div>
                  {/* Geniş ekranda tür etiketleri, dar ekranda renkli noktalar */}
                  <div className={`hidden flex-col gap-1 sm:flex ${inMonth ? '' : 'opacity-50'}`}>
                    {counts.slice(0, 3).map(({ item, count }) => (
                      <span
                        key={item}
                        className={`flex items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CATEGORIES[item].pill}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORIES[item].dot}`} />
                        {count} {CATEGORIES[item].short}
                      </span>
                    ))}
                    {counts.length > 3 && <span className="px-1 text-[11px] text-slate-400">+{counts.length - 3} tür daha</span>}
                  </div>
                  <div className={`flex flex-wrap gap-1 sm:hidden ${inMonth ? '' : 'opacity-50'}`}>
                    {counts.map(({ item }) => (
                      <span key={item} className={`h-1.5 w-1.5 rounded-full ${CATEGORIES[item].dot}`} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Seçili günün ajandası */}
        <aside className={`${CARD} flex min-h-[320px] flex-col overflow-hidden xl:min-h-0`} aria-label="Günün işlemleri">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
              {selectedDate === todayIso ? 'Bugün' : 'Seçili gün'}
            </p>
            <h2 className="mt-0.5 text-lg font-bold capitalize text-slate-900">{selectedLabel}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dayEvents.length === 0 ? (
                <span className="text-sm text-slate-500">İşlem yok</span>
              ) : (
                CATEGORY_ORDER.map(item => ({ item, count: dayEvents.filter(entry => entry.category === item).length }))
                  .filter(entry => entry.count > 0)
                  .map(({ item, count }) => (
                    <span
                      key={item}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORIES[item].pill}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${CATEGORIES[item].dot}`} />
                      {count} {CATEGORIES[item].label}
                    </span>
                  ))
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {dayEvents.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <CalendarDays size={22} />
                </div>
                <p className="font-medium text-slate-700">Bu günde işlem yok</p>
                <p className="mt-1 text-sm text-slate-500">
                  {category !== 'all' || actor ? 'Seçili filtrelere uyan kayıt bulunmuyor.' : 'Takvimden başka bir gün seçin.'}
                </p>
              </div>
            ) : (
              <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[4.75rem] before:top-2 before:w-px before:bg-slate-200">
                {dayEvents.map(({ event, category: eventCategory }) => {
                  const info = CATEGORIES[eventCategory];
                  const Icon = event.action === 'land.deleted' ? Trash2 : event.action === 'land.bulk_created' ? Layers : info.icon;
                  const change = statusChange(event);
                  const land = describeLand(event);
                  const details = fieldChanges(event);
                  const customer = event.changes.customer_name as { new?: string } | undefined;
                  const canOpen = event.target_type === 'land' && /^\d+$/.test(event.target_id) && event.action !== 'land.deleted';
                  const isOpen = expanded.has(event.id);
                  return (
                    <li key={event.id} className="relative flex gap-3">
                      <time className="w-12 shrink-0 pt-2 text-right text-xs font-medium tabular-nums text-slate-400">
                        {new Date(event.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                      <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${info.iconBox}`}>
                        <Icon size={15} strokeWidth={2.5} />
                      </span>
                      <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                        <p className="text-sm font-semibold text-slate-800">{titleOf(event, eventCategory)}</p>
                        {land.place && <p className="mt-1 truncate text-sm text-slate-600" title={land.place}>{land.place}</p>}
                        {land.parcel && <p className="text-xs text-slate-500">{land.parcel}</p>}

                        {change && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">
                              {change.from ? statusLabels[change.from] : '—'}
                            </span>
                            <ArrowRight size={12} className="text-slate-400" />
                            <span className={`rounded-md px-2 py-0.5 font-medium ring-1 ring-inset ${info.pill}`}>{statusLabels[change.to]}</span>
                          </div>
                        )}
                        {customer?.new && (
                          <p className="mt-2 text-xs text-slate-500">
                            Müşteri: <span className="font-medium text-slate-700">{customer.new}</span>
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">
                              {initials(event.actor_username)}
                            </span>
                            {event.actor_username}
                          </span>
                          <span className="flex items-center gap-3">
                            {details.length > 0 && (
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => toggleExpanded(event.id)}
                                className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-800"
                              >
                                Değişiklikler
                                <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            {canOpen && (
                              <button
                                type="button"
                                onClick={() => openLand(event.target_id)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                              >
                                Arsayı aç
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </span>
                        </div>

                        {isOpen && (
                          <dl className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-xs">
                            {details.map(detail => (
                              <div key={detail.field} className="flex flex-wrap gap-x-2">
                                <dt className="font-semibold text-slate-600">{detail.label}:</dt>
                                <dd className="min-w-0 break-words text-slate-600">
                                  <span className="text-slate-400 line-through">{detail.from}</span>
                                  <span className="mx-1 text-slate-400">→</span>
                                  <span className="font-medium text-slate-800">{detail.to}</span>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
