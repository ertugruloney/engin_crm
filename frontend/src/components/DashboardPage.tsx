import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Filter,
  Handshake,
  KeyRound,
  MapPin,
  Pencil,
  ShieldCheck,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import TurkeyMapModule from 'react-turkey-map';
import { getAuditLogs, getCurrentUser, getLands, getSalesLeaderboard } from '../api';
import type { AuditLogEntry } from '../api';
import { ACTION_LABELS } from '../labels';
import { REGIONS, getProvincePlate, normalizeCityName } from '../regions';
import { statusLabels } from '../types';
import type { Land, LandStatus } from '../types';

const TurkeyMap = (TurkeyMapModule as any).default ?? (TurkeyMapModule as any);

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';
type ChartMode = 'monthly' | 'quarterly' | 'yearly';
type DateRange = { from: string; to: string };

const EMPTY_LANDS: Land[] = [];
const STATUS_ORDER: LandStatus[] = ['BOS', 'REZERV', 'KAPORA_ALINDI', 'TAPU'];
const SPARK_BUCKETS = 10;

const PERIOD_TABS: { value: Exclude<Period, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Bugün' },
  { value: 'week', label: 'Bu Hafta' },
  { value: 'month', label: 'Bu Ay' },
  { value: 'year', label: 'Bu Yıl' },
];

const COMPARE_LABELS: Record<Period, string> = {
  today: 'Düne göre',
  week: 'Geçen haftaya göre',
  month: 'Geçen aya göre',
  year: 'Geçen yıla göre',
  custom: 'Önceki döneme göre',
};

const CHART_MODES: { value: ChartMode; label: string }[] = [
  { value: 'monthly', label: 'Aylık' },
  { value: 'quarterly', label: 'Çeyreklik' },
  { value: 'yearly', label: 'Yıllık' },
];

const CARD = 'rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,35,95,0.06)] ring-1 ring-slate-100';

const STATUS_DOT_COLORS: Record<LandStatus, string> = {
  BOS: 'bg-emerald-400',
  REZERV: 'bg-amber-400',
  KAPORA_ALINDI: 'bg-blue-500',
  TAPU: 'bg-slate-500',
};

const MAP_LOW = '#dbeafe';
const MAP_HIGH = '#1d4ed8';

// İki hex renk arasında doğrusal geçiş.
const mixColor = (from: string, to: string, ratio: number) => {
  const parse = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const [a, b] = [parse(from), parse(to)];
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * ratio).toString(16).padStart(2, '0')).join('')}`;
};

// ---------------------------------------------------------------------------
// Tarih ve biçim yardımcıları
// ---------------------------------------------------------------------------

const toLocalISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseLocalDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const shiftDate = (date: Date, unit: 'day' | 'month' | 'year', amount: number) => {
  const result = new Date(date);
  if (unit === 'day') result.setDate(result.getDate() + amount);
  else if (unit === 'month') result.setMonth(result.getMonth() + amount);
  else result.setFullYear(result.getFullYear() + amount);
  return result;
};

// Seçili dönem ve karşılaştırma için önceki eşdeğer dönem (aynı uzunlukta).
const getPeriodBounds = (period: Period, customRange: DateRange, now: Date) => {
  if (period === 'custom') {
    const from = parseLocalDate(customRange.from);
    const to = shiftDate(parseLocalDate(customRange.to), 'day', 1);
    const length = to.getTime() - from.getTime();
    return { from, to, prevFrom: new Date(from.getTime() - length), prevTo: from };
  }
  const today = startOfDay(now);
  let from = today;
  if (period === 'week') from = shiftDate(today, 'day', -((today.getDay() + 6) % 7));
  if (period === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
  if (period === 'year') from = new Date(today.getFullYear(), 0, 1);
  const [unit, amount] = period === 'today' ? (['day', -1] as const) : period === 'week' ? (['day', -7] as const)
    : period === 'month' ? (['month', -1] as const) : (['year', -1] as const);
  return { from, to: now, prevFrom: shiftDate(from, unit, amount), prevTo: shiftDate(now, unit, amount) };
};

const getTrend = (current: number, previous: number) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);

const formatAxisValue = (value: number) => {
  const format = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  if (value >= 1_000_000) return `${format(value / 1_000_000)}M`;
  if (value >= 1_000) return `${format(value / 1_000)}K`;
  return format(value);
};

// Eksen için 1, 2, 2.5, 5, 10 katlarına yuvarlanmış üst sınır.
const niceCeil = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
};

const formatRelative = (value: string) => {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;
  return new Date(value).toLocaleDateString('tr-TR', { dateStyle: 'medium' });
};

const getSalesChartBuckets = (mode: ChartMode, now: Date) => {
  const bucketCount = mode === 'monthly' ? 12 : mode === 'quarterly' ? 8 : 5;
  const monthsPerBucket = mode === 'monthly' ? 1 : mode === 'quarterly' ? 3 : 12;
  const currentMonth =
    mode === 'monthly' ? now.getMonth() : mode === 'quarterly' ? Math.floor(now.getMonth() / 3) * 3 : 0;
  const currentStart = new Date(now.getFullYear(), currentMonth, 1);

  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(currentStart);
    start.setMonth(start.getMonth() - (bucketCount - index - 1) * monthsPerBucket);
    const end = new Date(start);
    end.setMonth(end.getMonth() + monthsPerBucket);

    const year = start.getFullYear();
    const quarter = Math.floor(start.getMonth() / 3) + 1;
    const label =
      mode === 'monthly'
        ? start.toLocaleDateString('tr-TR', { month: 'short' })
        : mode === 'quarterly'
          ? `Ç${quarter} '${String(year).slice(2)}`
          : String(year);
    const fullLabel =
      mode === 'monthly'
        ? start.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
        : mode === 'quarterly'
          ? `${year} ${quarter}. çeyrek`
          : String(year);

    return { start, end, label, fullLabel, amount: 0, count: 0 };
  });
};

// Noktalardan yumuşak (bezier) çizgi üretir.
const smoothPath = (pts: { x: number; y: number }[]) => {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
};

// Denetim kaydını "Yeni satış gerçekleştirildi" tarzı bir aktiviteye çevirir.
const describeActivity = (entry: AuditLogEntry) => {
  const status = entry.changes.status as { new?: LandStatus } | undefined;
  const label = typeof entry.changes.land_label === 'string' ? entry.changes.land_label : '';
  const [il, ilce] = label.split(',').map(part => part.trim());
  const location = il ? [il, ilce].filter(Boolean).join(' / ') : `Arsa #${entry.target_id}`;

  if (entry.action === 'land.status_changed' && status?.new) {
    if (status.new === 'TAPU') return { title: 'Yeni satış gerçekleştirildi', location, Icon: Check, iconClass: 'bg-emerald-50 text-emerald-500' };
    if (status.new === 'KAPORA_ALINDI') return { title: 'Kapora alındı', location, Icon: ShieldCheck, iconClass: 'bg-teal-50 text-teal-500' };
    if (status.new === 'REZERV') return { title: 'Yeni müşteri rezervasyonu', location, Icon: UserRound, iconClass: 'bg-blue-50 text-blue-600' };
    return { title: 'Arsa satışa açıldı', location, Icon: KeyRound, iconClass: 'bg-amber-50 text-amber-500' };
  }
  if (entry.action === 'land.created' || entry.action === 'land.bulk_created') {
    return { title: 'Yeni arsa eklendi', location, Icon: CalendarPlus, iconClass: 'bg-violet-50 text-violet-500' };
  }
  return { title: ACTION_LABELS[entry.action] ?? entry.action, location, Icon: Pencil, iconClass: 'bg-slate-100 text-slate-500' };
};

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

type Tone = 'blue' | 'green' | 'violet' | 'teal';
const TONES: Record<Tone, { icon: string; spark: string }> = {
  blue: { icon: 'bg-blue-50 text-blue-600', spark: '#3b82f6' },
  green: { icon: 'bg-emerald-50 text-emerald-500', spark: '#10b981' },
  violet: { icon: 'bg-violet-50 text-violet-500', spark: '#8b5cf6' },
  teal: { icon: 'bg-teal-50 text-teal-500', spark: '#14b8a6' },
};

function Sparkline({ values, color, id }: { values: number[]; color: string; id: string }) {
  const width = 140;
  const height = 60;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - 6 - (value / max) * (height - 16),
  }));
  const line = smoothPath(points);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="absolute bottom-0 right-0 h-16 w-36">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  trend,
  compareLabel,
  note,
  spark,
}: {
  icon: typeof Handshake;
  tone: Tone;
  label: string;
  value: string | number;
  trend: number | null;
  compareLabel: string;
  note?: string;
  spark: number[];
}) {
  const TrendIcon = trend !== null && trend < 0 ? ArrowDown : ArrowUp;
  return (
    <div className={`${CARD} relative overflow-hidden p-5`}>
      <Sparkline values={spark} color={TONES[tone].spark} id={`spark-${tone}`} />
      <div className="relative flex gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${TONES[tone].icon}`}>
          <Icon size={26} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-600">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          <p className="mt-3 flex items-center gap-2 text-xs">
            {trend !== null ? (
              <span className={`inline-flex items-center gap-0.5 font-semibold ${trend < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                <TrendIcon size={13} />%{Math.abs(trend)}
              </span>
            ) : null}
            <span className="text-slate-400">{trend !== null ? compareLabel : note ?? 'Karşılaştırma verisi yok'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function CardTitle({ icon: Icon, iconClass, title }: { icon: typeof Handshake; iconClass: string; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-800">
      <Icon size={20} className={iconClass} />
      {title}
    </h2>
  );
}

function CustomRangePicker({
  active,
  value,
  onApply,
}: {
  active: boolean;
  value: DateRange;
  onApply: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const formatShort = (iso: string) => parseLocalDate(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setDraft(value);
          setOpen(current => !current);
        }}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-sm ring-1 transition-colors ${
          active ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
        }`}
      >
        <CalendarDays size={16} />
        {active ? `${formatShort(value.from)} – ${formatShort(value.to)}` : 'Özel Tarih Aralığı'}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl bg-white p-4 shadow-xl ring-1 ring-slate-100">
          <div className="grid grid-cols-2 gap-3">
            {(['from', 'to'] as const).map(field => (
              <label key={field} className="text-xs font-medium text-slate-500">
                {field === 'from' ? 'Başlangıç' : 'Bitiş'}
                <input
                  type="date"
                  value={draft[field]}
                  onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                />
              </label>
            ))}
          </div>
          {draft.from > draft.to && draft.to && <p className="mt-2 text-xs text-red-600">Bitiş, başlangıçtan önce olamaz.</p>}
          <button
            type="button"
            disabled={invalid}
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
            className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Uygula
          </button>
        </div>
      )}
    </div>
  );
}

function CityDistrictModal({ city, lands, onClose }: { city: string; lands: Land[]; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const emptyCounts = () => Object.fromEntries(STATUS_ORDER.map(status => [status, 0])) as Record<LandStatus, number>;
  const cityCounts = emptyCounts();
  const districts: Record<string, { total: number; byStatus: Record<LandStatus, number>; amount: number }> = {};
  let cityAmount = 0;

  for (const land of lands) {
    const name = land.ilce.trim() || 'Belirtilmemiş';
    const district = (districts[name] ??= { total: 0, byStatus: emptyCounts(), amount: 0 });
    const amount = land.status === 'TAPU' ? Number(land.sale_price ?? 0) : 0;
    district.total += 1;
    district.byStatus[land.status] += 1;
    district.amount += amount;
    cityCounts[land.status] += 1;
    cityAmount += amount;
  }

  const rows = Object.entries(districts).sort((a, b) => b[1].total - a[1].total);
  const maxDistrictTotal = Math.max(1, ...rows.map(([, row]) => row.total));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-district-title"
        className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="city-district-title" className="flex items-center gap-2 text-xl font-bold text-slate-800">
              <MapPin size={20} className="text-blue-500" />
              {city}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {lands.length} arsa · {rows.length} ilçe · Satış tutarı {formatCurrency(cityAmount)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Kapat"
            onClick={onClose}
            className="rounded-full border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            <X size={20} />
          </button>
        </div>

        {lands.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Bu ilde kayıtlı arsa yok.</p>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATUS_ORDER.map(status => (
                <div key={status} className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT_COLORS[status]}`} />
                    {statusLabels[status]}
                  </p>
                  <p className="mt-1 text-xl font-bold text-slate-800">{cityCounts[status]}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead>
                  <tr>
                    {['İlçe', 'Arsa', ...STATUS_ORDER.map(status => statusLabels[status]), 'Satış Tutarı'].map(label => (
                      <th key={label} className="border-b border-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(([name, row]) => (
                    <tr key={name} className="transition-colors hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-800">{name}</p>
                        <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${(row.total / maxDistrictTotal) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-800">{row.total}</td>
                      {STATUS_ORDER.map(status => (
                        <td key={status} className="px-3 py-3 text-slate-700">{row.byStatus[status]}</td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                        {row.amount > 0 ? formatCurrency(row.amount) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sayfa
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('month');
  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const today = new Date();
    return { from: toLocalISODate(shiftDate(today, 'day', -29)), to: toLocalISODate(today) };
  });
  const [chartMode, setChartMode] = useState<ChartMode>('monthly');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [region, setRegion] = useState('all');
  const [selectedCity, setSelectedCity] = useState<{ plate: string | null; name: string } | null>(null);

  // Grafik, kartın gerçek genişliğine göre çizilir; böylece metinler bozulmadan genişler.
  const [chartContainer, setChartContainer] = useState<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(760);
  const [chartBoxHeight, setChartBoxHeight] = useState(300);
  useEffect(() => {
    if (!chartContainer) return;
    const observer = new ResizeObserver(([entry]) => {
      setChartWidth(Math.max(560, Math.round(entry.contentRect.width)));
      setChartBoxHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(chartContainer);
    return () => observer.disconnect();
  }, [chartContainer]);

  const bounds = useMemo(() => getPeriodBounds(period, customRange, new Date()), [period, customRange]);
  const apiRange = useMemo(
    () => ({ dateFrom: toLocalISODate(bounds.from), dateTo: toLocalISODate(new Date(bounds.to.getTime() - 1)) }),
    [bounds],
  );

  // Kişinin rapor sayfası; dashboard'da seçili dönem rapora da aynen taşınır.
  const personReportUrl = (username: string) => {
    const query = new URLSearchParams({ kisi: username });
    if (period === 'month' || period === 'year') {
      query.set('donem', period);
    } else {
      query.set('donem', 'custom');
      query.set('baslangic', apiRange.dateFrom);
      query.set('bitis', apiRange.dateTo);
    }
    return `/reports/person?${query.toString()}`;
  };

  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser });
  const landsQuery = useQuery({ queryKey: ['lands'], queryFn: getLands });
  const activitiesQuery = useQuery({
    queryKey: ['auditLogs', 'dashboard', apiRange],
    queryFn: () => getAuditLogs(1, apiRange),
  });
  const leaderboardQuery = useQuery({
    queryKey: ['salesLeaderboard', apiRange],
    queryFn: () => getSalesLeaderboard(apiRange),
  });

  const lands = landsQuery.data ?? EMPTY_LANDS;

  // ---- Özet kartları, bölgesel satışlar ----
  const stats = useMemo(() => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map(status => [status, 0])) as Record<LandStatus, number>;
    const byCity: Record<string, number> = {};
    const salesByCity: Record<string, number> = {};
    const span = Math.max(1, bounds.to.getTime() - bounds.from.getTime());
    const sparkIndex = (time: Date) =>
      Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor(((time.getTime() - bounds.from.getTime()) / span) * SPARK_BUCKETS)));
    const windowOf = (time: Date) => {
      if (time >= bounds.from && time <= bounds.to) return 'current';
      if (time >= bounds.prevFrom && time < bounds.prevTo) return 'previous';
      return null;
    };

    const amount = { current: 0, previous: 0 };
    const sales = { current: 0, previous: 0 };
    const customers = { current: new Set<string>(), previous: new Set<string>() };
    const sparkAmount = Array<number>(SPARK_BUCKETS).fill(0);
    const sparkSales = Array<number>(SPARK_BUCKETS).fill(0);
    const sparkCustomers = Array.from({ length: SPARK_BUCKETS }, () => new Set<string>());
    // Portföy değeri: fiyatı girilmiş arsaların, sürece girdikleri andan itibaren toplam değeri.
    const portfolio: { since: number; price: number }[] = [];

    for (const land of lands) {
      byStatus[land.status] += 1;
      byCity[land.il] = (byCity[land.il] ?? 0) + 1;
      const price = Number(land.sale_price ?? 0);
      const customer = land.customer_name.trim().toLocaleLowerCase('tr-TR');

      if (price > 0) {
        const first = land.status_history[0];
        portfolio.push({ since: first ? new Date(first.transitioned_at).getTime() : 0, price });
      }

      if (customer) {
        for (const entry of land.status_history) {
          if (entry.status === 'BOS') continue;
          const time = new Date(entry.transitioned_at);
          const target = windowOf(time);
          if (!target) continue;
          customers[target].add(customer);
          if (target === 'current') sparkCustomers[sparkIndex(time)].add(customer);
        }
      }

      if (land.status === 'TAPU') {
        const titleDeed = [...land.status_history].reverse().find(entry => entry.status === 'TAPU');
        if (!titleDeed) continue;
        const time = new Date(titleDeed.transitioned_at);
        const target = windowOf(time);
        if (!target) continue;
        sales[target] += 1;
        amount[target] += price;
        if (target === 'current') {
          sparkSales[sparkIndex(time)] += 1;
          sparkAmount[sparkIndex(time)] += price;
          salesByCity[land.il] = (salesByCity[land.il] ?? 0) + price;
        }
      }
    }

    const portfolioAt = (time: number) =>
      portfolio.reduce((sum, item) => (item.since <= time ? sum + item.price : sum), 0);
    const portfolioNow = portfolioAt(bounds.to.getTime());

    return {
      total: lands.length,
      byStatus,
      byCity,
      salesByCity,
      amount: amount.current,
      amountTrend: getTrend(amount.current, amount.previous),
      sales: sales.current,
      salesTrend: getTrend(sales.current, sales.previous),
      customers: customers.current.size,
      customersTrend: getTrend(customers.current.size, customers.previous.size),
      portfolio: portfolioNow,
      portfolioTrend: getTrend(portfolioNow, portfolioAt(bounds.prevTo.getTime())),
      pricedLands: portfolio.length,
      spark: {
        amount: sparkAmount,
        sales: sparkSales,
        customers: sparkCustomers.map(set => set.size),
        portfolio: Array.from({ length: SPARK_BUCKETS }, (_, index) =>
          portfolioAt(bounds.from.getTime() + ((index + 1) / SPARK_BUCKETS) * span),
        ),
      },
    };
  }, [lands, bounds]);

  // ---- Satış performansı ----
  const salesBuckets = useMemo(() => {
    const buckets = getSalesChartBuckets(chartMode, new Date());
    for (const land of lands) {
      if (land.status !== 'TAPU') continue;
      const titleDeed = [...land.status_history].reverse().find(entry => entry.status === 'TAPU');
      if (!titleDeed) continue;
      const time = new Date(titleDeed.transitioned_at);
      const bucket = buckets.find(item => time >= item.start && time < item.end);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.amount += Number(land.sale_price ?? 0);
    }
    return buckets;
  }, [lands, chartMode]);

  // ---- Bölgesel satış analizi ----
  const regionData = useMemo(() => {
    const regionPlates = region === 'all' ? null : new Set(REGIONS.find(item => item.value === region)?.plates);
    const salesByPlate: Record<string, { city: string; amount: number }> = {};
    for (const [city, amount] of Object.entries(stats.salesByCity)) {
      const plate = getProvincePlate(city);
      if (!plate || (regionPlates && !regionPlates.has(plate))) continue;
      const entry = (salesByPlate[plate] ??= { city, amount: 0 });
      entry.amount += amount;
    }
    const maxAmount = Math.max(1, ...Object.values(salesByPlate).map(item => item.amount));

    const colorData: Record<string, string> = {};
    const tooltipData: Record<string, string> = {};
    for (let plate = 1; plate <= 81; plate += 1) {
      const code = String(plate).padStart(2, '0');
      colorData[code] = regionPlates && !regionPlates.has(code) ? '#f1f5f9' : '#e8eefb';
    }
    for (const [plate, item] of Object.entries(salesByPlate)) {
      colorData[plate] = mixColor(MAP_LOW, MAP_HIGH, item.amount / maxAmount);
      tooltipData[plate] = formatCurrency(item.amount);
    }

    const topCities = Object.values(salesByPlate)
      .filter(item => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    return { colorData, tooltipData, topCities };
  }, [stats.salesByCity, region]);

  const selectedCityLands = useMemo(() => {
    if (!selectedCity) return EMPTY_LANDS;
    return lands.filter(land =>
      selectedCity.plate
        ? getProvincePlate(land.il) === selectedCity.plate
        : normalizeCityName(land.il) === normalizeCityName(selectedCity.name),
    );
  }, [lands, selectedCity]);

  if (landsQuery.isLoading) {
    return <div className="flex-1 text-center text-slate-500">Gösterge paneli yükleniyor...</div>;
  }
  if (landsQuery.isError) {
    return <div role="alert" className="text-red-600">Veriler yüklenemedi: {landsQuery.error.message}</div>;
  }

  const compareLabel = COMPARE_LABELS[period];

  // Grafik geometrisi: çizgi = satış tutarı (sol eksen), sütun = satış adedi (ipucunda değeriyle).
  // Yükseklik kartın boş alanından gelir; kaydırma çubuğu için küçük bir pay bırakılır.
  const chartHeight = Math.max(240, chartBoxHeight - 36);
  const padLeft = 48;
  const padRight = 8;
  const padTop = 20;
  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop;
  const baselineY = padTop + innerH;
  const step = innerW / salesBuckets.length;
  const amountMax = niceCeil(Math.max(...salesBuckets.map(point => point.amount)));
  const countMax = Math.max(1, ...salesBuckets.map(point => point.count));
  const salesTotal = salesBuckets.reduce((total, point) => total + point.amount, 0);
  const salesPoints = salesBuckets.map((point, index) => ({
    ...point,
    x: padLeft + step * (index + 0.5),
    y: baselineY - (point.amount / amountMax) * innerH,
    barY: baselineY - (point.count / countMax) * innerH * 0.85,
  }));
  const linePath = smoothPath(salesPoints);
  const peakIndex = salesPoints.reduce((best, point, index) => (point.amount > salesPoints[best].amount ? index : best), 0);
  const activeIndex = hoverIndex ?? (salesTotal > 0 ? peakIndex : null);
  const active = activeIndex !== null ? salesPoints[activeIndex] : null;
  const barWidth = Math.min(36, step * 0.5);

  // Satış süreci (huni): her aşama, o aşamaya ulaşmış arsa sayısı.
  const funnel = [
    { label: 'Toplam Arsa', value: stats.total, color: 'from-blue-500 to-blue-400' },
    { label: 'Rezervasyon', value: stats.byStatus.REZERV + stats.byStatus.KAPORA_ALINDI + stats.byStatus.TAPU, color: 'from-sky-400 to-sky-300' },
    { label: 'Kapora Alındı', value: stats.byStatus.KAPORA_ALINDI + stats.byStatus.TAPU, color: 'from-emerald-400 to-emerald-300' },
    { label: 'Tapu Verildi', value: stats.byStatus.TAPU, color: 'from-teal-300 to-teal-200' },
  ];
  const funnelDots = ['bg-blue-500', 'bg-sky-400', 'bg-emerald-400', 'bg-teal-300'];

  const leaderboard = (leaderboardQuery.data?.results ?? []).filter(row => row.sales > 0 || row.reservations > 0).slice(0, 5);
  const activities = (activitiesQuery.data?.results ?? []).filter(entry => entry.target_type === 'land').slice(0, 5);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* Karşılama + dönem seçimi */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {currentUser ? `Merhaba ${currentUser.username},` : 'Merhaba,'}
          </h1>
          <p className="mt-2 text-slate-500">Şirketinizin genel durumu aşağıda özetlenmiştir.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Dönem" className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {PERIOD_TABS.map(tab => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={period === tab.value}
                onClick={() => setPeriod(tab.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  period === tab.value ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <CustomRangePicker
            active={period === 'custom'}
            value={customRange}
            onApply={range => {
              setCustomRange(range);
              setPeriod('custom');
            }}
          />
        </div>
      </div>

      {/* Özet kartları */}
      <section aria-label="Özet" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Coins}
          tone="blue"
          label="Toplam Satış Tutarı"
          value={formatCurrency(stats.amount)}
          trend={stats.amountTrend}
          compareLabel={compareLabel}
          spark={stats.spark.amount}
        />
        <StatCard
          icon={Handshake}
          tone="green"
          label="Gerçekleşen Satış Adedi"
          value={stats.sales}
          trend={stats.salesTrend}
          compareLabel={compareLabel}
          spark={stats.spark.sales}
        />
        <StatCard
          icon={Users}
          tone="violet"
          label="Aktif Müşteriler"
          value={stats.customers}
          trend={stats.customersTrend}
          compareLabel={compareLabel}
          spark={stats.spark.customers}
        />
        <StatCard
          icon={Building2}
          tone="teal"
          label="Portföy Değeri"
          value={formatCurrency(stats.portfolio)}
          trend={stats.portfolioTrend}
          compareLabel={compareLabel}
          note={`${stats.pricedLands} fiyatlı arsa`}
          spark={stats.spark.portfolio}
        />
      </section>

      {/* Satış performansı + Bölgesel satış analizi */}
      <section className="grid flex-[3] gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className={`${CARD} flex min-w-0 flex-col p-6`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <CardTitle icon={TrendingUp} iconClass="text-blue-600" title="Satış Performansı" />
            <div role="group" aria-label="Grafik aralığı" className="inline-flex rounded-full p-0.5 ring-1 ring-slate-200">
              {CHART_MODES.map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={chartMode === mode.value}
                  onClick={() => {
                    setChartMode(mode.value);
                    setHoverIndex(null);
                  }}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${
                    chartMode === mode.value ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-1 flex justify-end gap-5 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Satış Tutarı</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-200" />Satış Adedi</span>
          </div>

          {/* SVG mutlak konumlu: kartın yüksekliğini belirlemez, kartın boş alanını doldurur. */}
          <div ref={setChartContainer} className="relative min-h-[280px] flex-1 overflow-x-auto overflow-y-hidden">
            <svg
              width={chartWidth}
              height={chartHeight + 30}
              viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
              className="absolute left-0 top-0 block"
              role="img"
              aria-label={`Satış performansı grafiği. Toplam ${formatCurrency(salesTotal)}.`}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id="dashBarFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#bfdbfe" />
                  <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.7" />
                </linearGradient>
              </defs>

              {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
                const y = baselineY - ratio * innerH;
                return (
                  <g key={ratio}>
                    <line x1={padLeft} x2={chartWidth - padRight} y1={y} y2={y} stroke="#eef2f7" />
                    <text x={padLeft - 12} y={y + 4} textAnchor="end" fill="#64748b" fontSize="11">
                      {formatAxisValue(amountMax * ratio)}
                    </text>
                  </g>
                );
              })}

              {salesPoints.map((point, index) => (
                <g key={`${point.label}-${index}`}>
                  <rect
                    x={point.x - barWidth / 2}
                    y={point.barY}
                    width={barWidth}
                    height={Math.max(baselineY - point.barY, 0)}
                    rx="4"
                    fill="url(#dashBarFill)"
                  />
                  <text x={point.x} y={chartHeight + 20} textAnchor="middle" fill="#64748b" fontSize="11">
                    {point.label}
                  </text>
                </g>
              ))}

              {active && (
                <line x1={active.x} x2={active.x} y1={padTop} y2={baselineY} stroke="#3b82f6" strokeOpacity="0.5" />
              )}

              {salesPoints.length > 1 && (
                <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
              )}
              {salesPoints.map((point, index) => (
                <circle
                  key={`dot-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={activeIndex === index ? 7 : 4}
                  fill="#2563eb"
                  stroke="white"
                  strokeWidth="2"
                />
              ))}

              {salesPoints.map((point, index) => (
                <rect
                  key={`hit-${index}`}
                  x={point.x - step / 2}
                  y={padTop}
                  width={step}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                />
              ))}

              {active && (() => {
                const boxWidth = 138;
                const boxX = Math.min(Math.max(active.x - boxWidth - 12, padLeft), chartWidth - padRight - boxWidth);
                const boxY = Math.max(Math.min(active.y, active.barY) - 30, 0);
                return (
                  <g pointerEvents="none">
                    <rect x={boxX} y={boxY} width={boxWidth} height="60" rx="8" fill="white" stroke="#e2e8f0" />
                    <text x={boxX + 12} y={boxY + 18} fill="#0f172a" fontSize="11" fontWeight="600">
                      {active.fullLabel}
                    </text>
                    <circle cx={boxX + 15} cy={boxY + 31} r="3.5" fill="#2563eb" />
                    <text x={boxX + 24} y={boxY + 35} fill="#0f172a" fontSize="12" fontWeight="700">
                      {formatCurrency(active.amount)}
                    </text>
                    <circle cx={boxX + 15} cy={boxY + 47} r="3.5" fill="#93c5fd" />
                    <text x={boxX + 24} y={boxY + 51} fill="#334155" fontSize="11">
                      {active.count} adet
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
          {salesTotal === 0 && (
            <p className="text-center text-sm text-slate-500">Bu aralıkta satış bedeli kaydedilmiş Tapu işlemi bulunmuyor.</p>
          )}
        </div>

        <div className={`${CARD} flex min-w-0 flex-col p-6`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <CardTitle icon={MapPin} iconClass="text-blue-600" title="Bölgesel Satış Analizi" />
            <label className="relative inline-flex items-center">
              <span className="sr-only">Bölge</span>
              <select
                value={region}
                onChange={event => setRegion(event.target.value)}
                className="appearance-none rounded-lg bg-transparent py-1 pl-2 pr-7 text-xs font-medium text-slate-600 hover:bg-slate-50 focus:outline-none"
              >
                <option value="all">Tüm Bölgeler</option>
                {REGIONS.map(item => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 text-slate-500" />
            </label>
          </div>

          <div className="grid flex-1 items-center gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="cursor-pointer [&_path:hover]:opacity-80">
                <TurkeyMap
                  colorData={regionData.colorData}
                  tooltipData={regionData.tooltipData}
                  showTooltip
                  clickableCities
                  showCityTooltip
                  onCityClick={({ plate, city }: { plate: string | null; city: string | null }) => {
                    if (city) setSelectedCity({ plate, name: city });
                  }}
                />
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
                Düşük
                <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${MAP_LOW}, ${MAP_HIGH})` }} />
                Yüksek
              </div>
              <p className="mt-2 text-xs text-slate-400">İlçe detayı için bir ile tıklayın.</p>
            </div>

            <div className="min-w-0">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">En Başarılı 5 İl</h3>
              {regionData.topCities.length === 0 ? (
                <p className="text-sm text-slate-500">Bu dönemde satış yok.</p>
              ) : (
                <ol className="space-y-3">
                  {regionData.topCities.map((item, index) => (
                    <li key={item.city}>
                      <button
                        type="button"
                        onClick={() => setSelectedCity({ plate: getProvincePlate(item.city) ?? null, name: item.city })}
                        className="flex w-full items-center gap-3 rounded-lg text-left text-sm hover:bg-slate-50"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                          {index + 1}
                        </span>
                        <span className="flex-1 truncate text-slate-700">{item.city}</span>
                        <span className="font-semibold text-slate-800">{formatCurrency(item.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Satış süreci + Liderlik tablosu + Son aktiviteler */}
      <section className="grid flex-[2] gap-5 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1.1fr)]">
        <div className={`${CARD} flex min-w-0 flex-col p-6`}>
          <div className="mb-5">
            <CardTitle icon={Filter} iconClass="text-blue-600" title="Satış Süreci" />
          </div>
          <ul className="flex flex-1 flex-col justify-center gap-3">
            {funnel.map((stage, index) => {
              const top = 100 - index * 14;
              const bottom = top - 14;
              const percent = stats.total > 0 ? Math.round((stage.value / stats.total) * 100) : 0;
              return (
                <li key={stage.label} className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] items-center gap-4">
                  <div
                    className={`h-12 bg-gradient-to-b ${stage.color}`}
                    style={{
                      clipPath: `polygon(${(100 - top) / 2}% 0, ${(100 + top) / 2}% 0, ${(100 + bottom) / 2}% 100%, ${(100 - bottom) / 2}% 100%)`,
                    }}
                  />
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${funnelDots[index]}`} />
                    <span className="flex-1 truncate text-slate-700">{stage.label}</span>
                    <span className="font-semibold text-slate-800">{stage.value}</span>
                    <span className="w-11 text-right text-xs text-slate-400">{index > 0 ? `(%${percent})` : ''}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={`${CARD} min-w-0 p-6`}>
          <div className="mb-4">
            <CardTitle icon={Trophy} iconClass="text-amber-500" title="Satış Liderlik Tablosu" />
          </div>
          {leaderboardQuery.isLoading && <p className="text-sm text-slate-500">Yükleniyor...</p>}
          {leaderboardQuery.isError && <p role="alert" className="text-sm text-red-600">Liderlik tablosu yüklenemedi.</p>}
          {leaderboardQuery.data && leaderboard.length === 0 && (
            <p className="text-sm text-slate-500">Bu dönemde rezervasyon veya satış kaydı yok.</p>
          )}
          {leaderboard.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-500">
                    {['#', 'Satış Temsilcisi', 'Satış Adedi', 'Satış Tutarı', 'Dönüşüm'].map(label => (
                      <th key={label} className="border-b border-slate-100 px-2 pb-2.5 font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, index) => {
                    const conversion = row.reservations > 0 ? Math.round((row.sales / row.reservations) * 100) : null;
                    return (
                      <tr
                        key={row.username}
                        onClick={() => navigate(personReportUrl(row.username))}
                        className="group cursor-pointer transition-colors hover:bg-blue-50/50"
                      >
                        <td className="px-2 py-3.5">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                            {index + 1}
                          </span>
                        </td>
                        <td className="truncate px-2 py-2.5">
                          <Link
                            to={personReportUrl(row.username)}
                            onClick={event => event.stopPropagation()}
                            title={`${row.username} raporunu aç`}
                            className="font-medium text-slate-800 group-hover:text-blue-600 hover:underline"
                          >
                            {row.username}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 text-slate-700">{row.sales}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-slate-700">{formatCurrency(Number(row.amount))}</td>
                        <td className="px-2 py-2.5" title={`${row.reservations} rezervasyon, ${row.sales} satış`}>
                          <div className="flex items-center gap-2">
                            <span className="w-10 text-xs text-slate-600">{conversion !== null ? `%${conversion}` : '—'}</span>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${Math.min(conversion ?? 0, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={`${CARD} min-w-0 p-6 lg:col-span-2 2xl:col-span-1`}>
          <div className="mb-5 flex items-center justify-between gap-2">
            <CardTitle icon={Clock} iconClass="text-blue-600" title="Son Aktiviteler" />
            <Link to="/audit-logs" className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
              Tümünü Gör
              <ArrowRight size={14} />
            </Link>
          </div>
          {activitiesQuery.isLoading && <p className="text-sm text-slate-500">Aktiviteler yükleniyor...</p>}
          {activitiesQuery.isError && <p role="alert" className="text-sm text-red-600">Aktiviteler yüklenemedi.</p>}
          {activitiesQuery.data && activities.length === 0 && (
            <p className="text-sm text-slate-500">Seçili dönemde arsa işlemi yok.</p>
          )}
          <ul className="space-y-5">
            {activities.map(entry => {
              const { title, location, Icon, iconClass } = describeActivity(entry);
              return (
                <li key={entry.id} className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
                    <Icon size={18} strokeWidth={2.5} />
                  </div>
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{title}</p>
                      <p className="mt-0.5 truncate text-sm text-slate-500">
                        {location} ·{' '}
                        <Link
                          to={personReportUrl(entry.actor_username)}
                          title={`${entry.actor_username} raporunu aç`}
                          className="font-medium text-slate-600 hover:text-blue-600 hover:underline"
                        >
                          {entry.actor_username}
                        </Link>
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-slate-400">{formatRelative(entry.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {selectedCity && (
        <CityDistrictModal city={selectedCity.name} lands={selectedCityLands} onClose={() => setSelectedCity(null)} />
      )}
    </div>
  );
}
