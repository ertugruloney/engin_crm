import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronRight, Download, Home, MapPin, Users } from 'lucide-react';
import * as xlsx from 'xlsx';
import { getLands, getSalesLeaderboard, getViewerUsers } from '../api';
import { REGIONS, UNKNOWN_REGION, getRegionLabel } from '../regions';
import type { Land, LandStatus } from '../types';

// Raporlar, teknik bilgisi olmayan bir yöneticinin de bir bakışta anlayacağı şekilde sade tutulur:
// az sayı, büyük yazı, günlük dil; ayrıntıya kartlara tıklayarak inilir.

// Hangi raporun açık olduğu adresten gelir: /reports/region veya /reports/person.
export type ReportTab = 'region' | 'personnel';
type Preset = 'month' | 'quarter' | 'year' | 'all' | 'custom';
type DateRange = { from: string | null; to: string | null };
type StatusFilter = LandStatus | 'all';

const EMPTY_LANDS: Land[] = [];
const REGION_ORDER = [...REGIONS.map(region => region.label), UNKNOWN_REGION];

const PRESETS: { value: Exclude<Preset, 'custom'>; label: string }[] = [
  { value: 'month', label: 'Bu Ay' },
  { value: 'quarter', label: 'Son 3 Ay' },
  { value: 'year', label: 'Bu Yıl' },
  { value: 'all', label: 'Tüm Zamanlar' },
];

// Durumların günlük dildeki karşılıkları.
const STATUS_INFO: Record<LandStatus, { label: string; chip: string; dot: string }> = {
  TAPU: { label: 'Satıldı', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  KAPORA_ALINDI: { label: 'Kapora alındı', chip: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  REZERV: { label: 'Rezerve', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  BOS: { label: 'Boşta', chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
};
const STATUS_ORDER: LandStatus[] = ['TAPU', 'KAPORA_ALINDI', 'REZERV', 'BOS'];

const CARD = 'rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,35,95,0.06)] ring-1 ring-slate-100';

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const toLocalISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseLocalDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getPresetRange = (preset: Exclude<Preset, 'custom'>, today: Date): DateRange => {
  if (preset === 'all') return { from: null, to: null };
  const to = toLocalISODate(today);
  if (preset === 'month') return { from: toLocalISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  if (preset === 'year') return { from: toLocalISODate(new Date(today.getFullYear(), 0, 1)), to };
  const start = new Date(today);
  start.setDate(start.getDate() - 89);
  return { from: toLocalISODate(start), to };
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);

// "₺45,2 milyon" gibi okunması kolay para yazımı.
const formatMoney = (amount: number) => {
  const format = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  if (amount >= 1_000_000_000) return `₺${format(amount / 1_000_000_000)} milyar`;
  if (amount >= 1_000_000) return `₺${format(amount / 1_000_000)} milyon`;
  if (amount >= 1_000) return `₺${format(amount / 1_000)} bin`;
  return `₺${format(amount)}`;
};

const formatDate = (value: string | Date | null) =>
  value ? new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

// "demo.ahmet.yilmaz" -> "Ahmet Yilmaz"
const displayName = (username: string) =>
  username
    .split(/[._-]+/)
    .filter(part => part && part !== 'demo')
    .map(part => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ') || username;

type Metrics = { lands: number; available: number; reservations: number; deposits: number; sales: number; amount: number };
const emptyMetrics = (): Metrics => ({ lands: 0, available: 0, reservations: 0, deposits: 0, sales: 0, amount: 0 });

// Her arsanın rapora giren olayları: rezervasyonlar, son kapora ve (hâlâ tapuluysa) son tapu.
type LandEvents = {
  land: Land;
  region: string;
  reservations: Date[];
  deposit: Date | null;
  sale: { at: Date; amount: number } | null;
  lastActivity: Date | null;
};

const toLandEvents = (land: Land): LandEvents => {
  const at = (status: string) =>
    land.status_history.filter(entry => entry.status === status).map(entry => new Date(entry.transitioned_at));
  const titleDeeds = at('TAPU');
  const last = land.status_history.at(-1);
  return {
    land,
    region: getRegionLabel(land.il),
    reservations: at('REZERV'),
    deposit: at('KAPORA_ALINDI').at(-1) ?? null,
    sale:
      land.status === 'TAPU' && titleDeeds.length > 0
        ? { at: titleDeeds[titleDeeds.length - 1], amount: Number(land.sale_price ?? 0) }
        : null,
    lastActivity: last ? new Date(last.transitioned_at) : null,
  };
};

const addToMetrics = (target: Metrics, item: LandEvents, inRange: (date: Date) => boolean) => {
  target.lands += 1;
  if (item.land.status === 'BOS') target.available += 1;
  target.reservations += item.reservations.filter(inRange).length;
  if (item.deposit && inRange(item.deposit)) target.deposits += 1;
  if (item.sale && inRange(item.sale.at)) {
    target.sales += 1;
    target.amount += item.sale.amount;
  }
};

const exportToExcel = (sheets: { name: string; rows: Record<string, string | number>[] }[], fileName: string) => {
  const workbook = xlsx.utils.book_new();
  for (const sheet of sheets) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(sheet.rows), sheet.name);
  }
  xlsx.writeFile(workbook, fileName);
};

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

// Sayfanın en üstündeki tek cümlelik özet.
function Headline({ place, period, metrics }: { place: string; period: string; metrics: Pick<Metrics, 'sales' | 'amount' | 'reservations' | 'deposits'> }) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#13254f] to-[#1d4ed8] p-6 text-white shadow-lg sm:p-8">
      <p className="text-sm font-medium text-blue-100">
        {place} · {period}
      </p>
      {metrics.sales > 0 ? (
        <p className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">
          {metrics.sales} arsa satıldı, toplam{' '}
          <span className="whitespace-nowrap" title={formatCurrency(metrics.amount)}>{formatMoney(metrics.amount)}</span>.
        </p>
      ) : (
        <p className="mt-2 text-2xl font-bold sm:text-3xl">Bu dönemde satış yapılmadı.</p>
      )}
      <p className="mt-2 text-blue-100">
        Ayrıca {metrics.reservations} arsa rezerve edildi, {metrics.deposits} arsadan kapora alındı.
      </p>
    </section>
  );
}

function NumberTile({ label, value, hint, color }: { label: string; value: string | number; hint: string; color: string }) {
  return (
    <div className={`${CARD} p-5`}>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <span className={`h-3 w-3 rounded-full ${color}`} />
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
    </div>
  );
}

function NumberTiles({ metrics }: { metrics: Pick<Metrics, 'sales' | 'amount' | 'reservations' | 'deposits'> }) {
  return (
    <section aria-label="Rakamlar" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <NumberTile label="Satılan arsa" value={metrics.sales} hint="Tapusu verilen arsalar" color={STATUS_INFO.TAPU.dot} />
      <NumberTile label="Gelen para" value={formatMoney(metrics.amount)} hint="Satılan arsaların toplam fiyatı" color="bg-violet-500" />
      <NumberTile label="Kapora alınan" value={metrics.deposits} hint="Ön ödemesi alınan arsalar" color={STATUS_INFO.KAPORA_ALINDI.dot} />
      <NumberTile label="Rezerve edilen" value={metrics.reservations} hint="Müşterinin ayırttığı arsalar" color={STATUS_INFO.REZERV.dot} />
    </section>
  );
}

// Bir yer (bölge/il/ilçe) ya da kişi için tıklanabilir kart.
function SummaryCard({
  title,
  badge,
  amount,
  maxAmount,
  lines,
  onClick,
}: {
  title: string;
  badge?: React.ReactNode;
  amount: number;
  maxAmount: number;
  lines: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CARD} group flex flex-col p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-blue-200 ${
        amount === 0 ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        {badge}
        <p className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-800">{title}</p>
        <ChevronRight size={20} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-500" />
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900" title={formatCurrency(amount)}>
        {amount > 0 ? formatMoney(amount) : 'Satış yok'}
      </p>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${maxAmount > 0 ? (amount / maxAmount) * 100 : 0}%` }} />
      </div>
      <div className="mt-3 space-y-0.5 text-sm text-slate-500">
        {lines.map(line => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </button>
  );
}

function StatusChip({ status }: { status: LandStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${STATUS_INFO[status].chip}`}>
      {STATUS_INFO[status].label}
    </span>
  );
}

type LandRow = { land: Land; date: Date | string | null; amount: number };

// Arsa listesi: durum düğmeleriyle süzülür, satıra tıklanınca arsa açılır.
function LandList({
  title,
  rows,
  status,
  onStatusChange,
  onOpen,
}: {
  title: string;
  rows: LandRow[];
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  onOpen: (landId: number) => void;
}) {
  const counts = Object.fromEntries(STATUS_ORDER.map(item => [item, rows.filter(row => row.land.status === item).length])) as Record<LandStatus, number>;
  const visible = status === 'all' ? rows : rows.filter(row => row.land.status === status);
  const chips: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'Hepsi', count: rows.length },
    ...STATUS_ORDER.map(item => ({ value: item, label: STATUS_INFO[item].label, count: counts[item] })),
  ];

  return (
    <section className={`${CARD} min-w-0 p-6`}>
      <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">Bir arsanın ayrıntısını görmek için üzerine tıklayın.</p>

      <div role="group" aria-label="Arsa durumu" className="mt-4 flex flex-wrap gap-2">
        {chips.map(chip => (
          <button
            key={chip.value}
            type="button"
            aria-pressed={status === chip.value}
            onClick={() => onStatusChange(chip.value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              status === chip.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {chip.label} <span className="opacity-70">({chip.count})</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-slate-500">Burada gösterilecek arsa yok.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {visible.map(row => (
            <li key={row.land.id}>
              <button
                type="button"
                onClick={() => onOpen(row.land.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-3 py-4 text-left transition-colors hover:bg-blue-50/60"
              >
                <div className="min-w-[14rem] flex-1">
                  <p className="font-semibold text-slate-800">
                    {row.land.il} / {row.land.ilce}
                  </p>
                  <p className="text-sm text-slate-500">
                    {row.land.mahalle} · Ada {row.land.ada}, Parsel {row.land.parsel}
                  </p>
                </div>
                <StatusChip status={row.land.status} />
                <div className="w-40 text-sm">
                  <p className="text-slate-400">Müşteri</p>
                  <p className="truncate text-slate-700">{row.land.customer_name || '—'}</p>
                </div>
                <div className="w-36 text-sm">
                  <p className="text-slate-400">Tarih</p>
                  <p className="text-slate-700">{formatDate(row.date)}</p>
                </div>
                <div className="w-32 text-right">
                  <p className="text-sm text-slate-400">Fiyat</p>
                  <p className="font-semibold text-slate-800" title={row.amount ? formatCurrency(row.amount) : undefined}>
                    {row.amount ? formatMoney(row.amount) : '—'}
                  </p>
                </div>
                <ChevronRight size={20} className="shrink-0 text-slate-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const RANK_BADGES = ['bg-amber-100 text-amber-700', 'bg-slate-200 text-slate-700', 'bg-orange-100 text-orange-700'];

// ---------------------------------------------------------------------------
// Sayfa
// ---------------------------------------------------------------------------

export default function ReportsPage({ tab }: { tab: ReportTab }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Seçimler adreste tutulur; arsa detayından geri dönünce aynı görünüm açılır.
  const [params, setParams] = useSearchParams();
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

  const presetParam = params.get('donem');
  const preset: Preset = PRESETS.some(item => item.value === presetParam) || presetParam === 'custom' ? (presetParam as Preset) : 'year';
  const fromParam = params.get('baslangic');
  const toParam = params.get('bitis');
  const range = useMemo<DateRange>(
    () => (preset === 'custom' ? { from: fromParam, to: toParam } : getPresetRange(preset, new Date())),
    [preset, fromParam, toParam],
  );
  const statusParam = params.get('durum');
  const statusFilter: StatusFilter = STATUS_ORDER.includes(statusParam as LandStatus) ? (statusParam as LandStatus) : 'all';
  const regionFilter = params.get('bolge') ?? '';
  const cityFilter = params.get('il') ?? '';
  const districtFilter = params.get('ilce') ?? '';
  const personFilter = params.get('kisi') ?? '';
  const [showCustomDates, setShowCustomDates] = useState(preset === 'custom');

  const openLand = (landId: number) =>
    navigate(`/land/${landId}`, { state: { from: `${location.pathname}${location.search}` } });
  const setStatusFilter = (value: StatusFilter) => updateParams({ durum: value === 'all' ? null : value });

  const landsQuery = useQuery({ queryKey: ['lands'], queryFn: getLands });
  const leaderboardQuery = useQuery({
    queryKey: ['salesLeaderboard', 'reports', range],
    queryFn: () => getSalesLeaderboard({ dateFrom: range.from ?? undefined, dateTo: range.to ?? undefined }),
    enabled: tab === 'personnel',
  });
  const usersQuery = useQuery({ queryKey: ['viewerUsers'], queryFn: getViewerUsers, enabled: tab === 'personnel' });

  const lands = landsQuery.data ?? EMPTY_LANDS;
  const events = useMemo(() => lands.map(toLandEvents), [lands]);
  const landById = useMemo(() => new Map(lands.map(land => [land.id, land])), [lands]);

  const inRange = useMemo(() => {
    return (date: Date) => {
      const iso = toLocalISODate(date);
      return (!range.from || iso >= range.from) && (!range.to || iso <= range.to);
    };
  }, [range]);

  // ---- Bölge raporu: Türkiye → bölge → il → ilçe ----
  const level: 'region' | 'il' | 'ilce' | 'land' = districtFilter ? 'land' : cityFilter ? 'ilce' : regionFilter ? 'il' : 'region';
  const placeEvents = useMemo(
    () =>
      events.filter(
        item =>
          (!regionFilter || item.region === regionFilter) &&
          (!cityFilter || item.land.il === cityFilter) &&
          (!districtFilter || item.land.ilce === districtFilter),
      ),
    [events, regionFilter, cityFilter, districtFilter],
  );
  const placeTotals = useMemo(() => {
    const result = emptyMetrics();
    for (const item of placeEvents) addToMetrics(result, item, inRange);
    return result;
  }, [placeEvents, inRange]);
  const placeCards = useMemo(() => {
    if (level === 'land') return [];
    const keyOf = (item: LandEvents) =>
      (level === 'region' ? item.region : level === 'il' ? item.land.il : item.land.ilce) || 'Belirtilmemiş';
    const map = new Map<string, Metrics>();
    for (const item of placeEvents) {
      const key = keyOf(item);
      const metrics = map.get(key) ?? emptyMetrics();
      map.set(key, metrics);
      addToMetrics(metrics, item, inRange);
    }
    return [...map.entries()].sort(
      (a, b) =>
        b[1].amount - a[1].amount ||
        b[1].sales - a[1].sales ||
        (level === 'region' ? REGION_ORDER.indexOf(a[0]) - REGION_ORDER.indexOf(b[0]) : b[1].lands - a[1].lands),
    );
  }, [placeEvents, inRange, level]);
  const placeLandRows: LandRow[] = useMemo(
    () =>
      cityFilter
        ? [...placeEvents]
            .sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0))
            .map(item => ({ land: item.land, date: item.lastActivity, amount: item.land.status === 'TAPU' ? Number(item.land.sale_price ?? 0) : 0 }))
        : [],
    [placeEvents, cityFilter],
  );

  // ---- Kişi raporu ----
  const people = useMemo(
    () =>
      (leaderboardQuery.data?.results ?? []).map(row => ({
        username: row.username,
        reservations: row.reservations,
        deposits: row.deposits,
        sales: row.sales,
        amount: Number(row.amount),
        lands: row.lands,
      })),
    [leaderboardQuery.data],
  );
  const peopleTotals = people.reduce(
    (sum, row) => ({
      reservations: sum.reservations + row.reservations,
      deposits: sum.deposits + row.deposits,
      sales: sum.sales + row.sales,
      amount: sum.amount + row.amount,
    }),
    { reservations: 0, deposits: 0, sales: 0, amount: 0 },
  );
  const idlePeople = (usersQuery.data ?? [])
    .map(user => user.username)
    .filter(name => !people.some(row => row.username === name));
  const person = personFilter
    ? people.find(row => row.username === personFilter) ?? {
        username: personFilter,
        reservations: 0,
        deposits: 0,
        sales: 0,
        amount: 0,
        lands: [],
      }
    : null;
  const personRank = person ? people.findIndex(row => row.username === person.username) : -1;
  const personLandRows: LandRow[] = (person?.lands ?? []).flatMap(item => {
    const land = landById.get(item.land_id);
    if (!land) return [];
    return [{
      land,
      date: item.sold_at ?? item.deposit_at ?? item.reserved_at,
      amount: item.sold_at ? Number(land.sale_price ?? 0) : 0,
    }];
  });

  if (landsQuery.isLoading) return <div className="flex-1 py-12 text-center text-lg text-slate-500">Rapor hazırlanıyor...</div>;
  if (landsQuery.isError) {
    return <div role="alert" className="text-red-600">Veriler yüklenemedi: {landsQuery.error.message}</div>;
  }

  const periodText =
    preset === 'custom'
      ? `${range.from ? formatDate(parseLocalDate(range.from)) : 'Başlangıç'} – ${range.to ? formatDate(parseLocalDate(range.to)) : 'bugün'}`
      : PRESETS.find(item => item.value === preset)?.label ?? '';
  const fileSuffix = `${range.from ?? 'baslangic'}_${range.to ?? 'bugun'}`;

  // Bölge yolu: Türkiye › Marmara › İstanbul › Başakşehir
  const crumbs = [
    { label: 'Türkiye', onClick: () => updateParams({ bolge: null, il: null, ilce: null, durum: null }) },
    ...(regionFilter ? [{ label: regionFilter, onClick: () => updateParams({ il: null, ilce: null, durum: null }) }] : []),
    ...(cityFilter ? [{ label: cityFilter, onClick: () => updateParams({ ilce: null, durum: null }) }] : []),
    ...(districtFilter ? [{ label: districtFilter, onClick: () => undefined }] : []),
  ];
  const placeName = crumbs[crumbs.length - 1].label;
  const openPlace = (name: string) => {
    if (level === 'region') updateParams({ bolge: name });
    else if (level === 'il') updateParams({ il: name });
    else if (level === 'ilce') updateParams({ ilce: name });
  };
  const nextLevelName = level === 'region' ? 'Bölgeler' : level === 'il' ? 'İller' : 'İlçeler';

  const landRowsToExcel = (rows: LandRow[]) =>
    rows.map(row => ({
      İl: row.land.il,
      İlçe: row.land.ilce,
      Mahalle: row.land.mahalle,
      Ada: row.land.ada,
      Parsel: row.land.parsel,
      Durum: STATUS_INFO[row.land.status].label,
      Müşteri: row.land.customer_name,
      Tarih: formatDate(row.date),
      'Fiyat (₺)': row.amount,
    }));

  const handleExport = () => {
    if (tab === 'region') {
      const sheets: { name: string; rows: Record<string, string | number>[] }[] = [];
      if (placeCards.length > 0) {
        sheets.push({
          name: nextLevelName,
          rows: placeCards.map(([name, metrics]) => ({
            Yer: name,
            'Satılan Arsa': metrics.sales,
            'Gelen Para (₺)': metrics.amount,
            'Kapora Alınan': metrics.deposits,
            'Rezerve Edilen': metrics.reservations,
            'Toplam Arsa': metrics.lands,
            'Boşta Olan': metrics.available,
          })),
        });
      }
      if (placeLandRows.length > 0) sheets.push({ name: 'Arsalar', rows: landRowsToExcel(placeLandRows) });
      exportToExcel(sheets, `rapor-${crumbs.map(crumb => crumb.label).join('-')}-${fileSuffix}.xlsx`);
    } else if (person) {
      exportToExcel([{ name: 'Arsalar', rows: landRowsToExcel(personLandRows) }], `rapor-${displayName(person.username)}-${fileSuffix}.xlsx`);
    } else {
      exportToExcel(
        [
          {
            name: 'Kişiler',
            rows: people.map((row, index) => ({
              Sıra: index + 1,
              Kişi: displayName(row.username),
              'Satılan Arsa': row.sales,
              'Gelen Para (₺)': row.amount,
              'Kapora Alınan': row.deposits,
              'Rezerve Edilen': row.reservations,
            })),
          },
        ],
        `rapor-kisiler-${fileSuffix}.xlsx`,
      );
    }
  };

  const maxPlaceAmount = Math.max(0, ...placeCards.map(([, metrics]) => metrics.amount));
  const maxPersonAmount = Math.max(0, ...people.map(row => row.amount));

  return (
    <div className="w-full space-y-6">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900">
            {tab === 'region' ? <MapPin size={30} className="text-blue-600" /> : <Users size={30} className="text-blue-600" />}
            {tab === 'region' ? 'Bölgelere Göre Satışlar' : 'Kişilere Göre Satışlar'}
          </h1>
          <p className="mt-2 text-lg text-slate-500">
            {tab === 'region'
              ? 'Hangi bölgede, hangi ilde ne kadar satış yapıldığını görün. Ayrıntı için kartlara tıklayın.'
              : 'Kimin ne kadar satış yaptığını görün. Ayrıntı için bir kişiye tıklayın.'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={tab === 'personnel' && !leaderboardQuery.data}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
        >
          <Download size={16} />
          Excel olarak indir
        </button>
      </div>

      {/* Tarih seçimi */}
      <div className={`${CARD} flex flex-wrap items-center gap-3 p-4`}>
        <span className="flex items-center gap-2 text-base font-semibold text-slate-700">
          <CalendarDays size={20} className="text-blue-600" />
          Hangi dönem?
        </span>
        {PRESETS.map(item => (
          <button
            key={item.value}
            type="button"
            aria-pressed={preset === item.value}
            onClick={() => {
              setShowCustomDates(false);
              updateParams({ donem: item.value, baslangic: null, bitis: null });
            }}
            className={`rounded-xl px-5 py-2.5 text-base font-medium transition-colors ${
              preset === item.value ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={showCustomDates}
          onClick={() => setShowCustomDates(current => !current)}
          className={`rounded-xl px-5 py-2.5 text-base font-medium transition-colors ${
            preset === 'custom' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Tarih seç
        </button>
        {showCustomDates && (
          <div className="flex w-full flex-wrap items-end gap-4 border-t border-slate-100 pt-3">
            {(['from', 'to'] as const).map(field => (
              <label key={field} className="text-sm font-medium text-slate-600">
                {field === 'from' ? 'Şu tarihten' : 'Şu tarihe kadar'}
                <input
                  type="date"
                  value={range[field] ?? ''}
                  max={field === 'from' ? range.to ?? undefined : undefined}
                  min={field === 'to' ? range.from ?? undefined : undefined}
                  onChange={event => {
                    const next = { ...range, [field]: event.target.value || null };
                    updateParams({ donem: 'custom', baslangic: next.from, bitis: next.to });
                  }}
                  className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 focus:border-blue-400 focus:outline-none"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {tab === 'region' && (
        <>
          {/* Nerede olduğumuz: Türkiye › Marmara › İstanbul */}
          <nav aria-label="Konum" className="flex flex-wrap items-center gap-2 text-lg">
            {crumbs.length > 1 && (
              <button
                type="button"
                onClick={crumbs[crumbs.length - 2].onClick}
                className="mr-2 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-base font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <ArrowLeft size={18} />
                Geri
              </button>
            )}
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <span key={crumb.label} className="flex items-center gap-2">
                  {index === 0 && <Home size={18} className="text-slate-400" />}
                  {last ? (
                    <span className="font-bold text-slate-900">{crumb.label}</span>
                  ) : (
                    <button type="button" onClick={crumb.onClick} className="font-medium text-blue-600 hover:underline">
                      {crumb.label}
                    </button>
                  )}
                  {!last && <ChevronRight size={18} className="text-slate-300" />}
                </span>
              );
            })}
          </nav>

          <Headline place={placeName} period={periodText} metrics={placeTotals} />
          <NumberTiles metrics={placeTotals} />

          {placeCards.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-bold text-slate-800">{nextLevelName}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {placeCards.map(([name, metrics]) => (
                  <SummaryCard
                    key={name}
                    title={name}
                    amount={metrics.amount}
                    maxAmount={maxPlaceAmount}
                    lines={[
                      `${metrics.sales} arsa satıldı`,
                      `Toplam ${metrics.lands} arsa, ${metrics.available} tanesi boşta`,
                    ]}
                    onClick={() => openPlace(name)}
                  />
                ))}
              </div>
            </section>
          )}

          {cityFilter && (
            <LandList
              title={`${placeName} arsaları`}
              rows={placeLandRows}
              status={statusFilter}
              onStatusChange={setStatusFilter}
              onOpen={openLand}
            />
          )}
        </>
      )}

      {tab === 'personnel' && !person && (
        <>
          <Headline place="Tüm kişiler" period={periodText} metrics={peopleTotals} />
          <NumberTiles metrics={peopleTotals} />
          <section>
            <h2 className="mb-3 text-xl font-bold text-slate-800">Kim ne kadar sattı?</h2>
            {leaderboardQuery.isLoading && <p className="text-slate-500">Yükleniyor...</p>}
            {leaderboardQuery.isError && <p role="alert" className="text-red-600">Kişi bilgileri yüklenemedi.</p>}
            {leaderboardQuery.data && people.length === 0 && (
              <p className={`${CARD} p-6 text-slate-500`}>Bu dönemde kimse işlem yapmadı.</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {people.map((row, index) => (
                <SummaryCard
                  key={row.username}
                  title={displayName(row.username)}
                  badge={
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                        RANK_BADGES[index] ?? 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {index + 1}.
                    </span>
                  }
                  amount={row.amount}
                  maxAmount={maxPersonAmount}
                  lines={[`${row.sales} arsa sattı`, `${row.deposits} kapora aldı, ${row.reservations} arsa ayırttı`]}
                  onClick={() => updateParams({ kisi: row.username, durum: null })}
                />
              ))}
            </div>
            {idlePeople.length > 0 && (
              <p className="mt-4 text-sm text-slate-500">
                Bu dönemde işlem yapmayanlar: {idlePeople.map(displayName).join(', ')}
              </p>
            )}
          </section>
        </>
      )}

      {tab === 'personnel' && person && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => updateParams({ kisi: null, durum: null })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-base font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              <ArrowLeft size={18} />
              Tüm kişiler
            </button>
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
                RANK_BADGES[personRank] ?? 'bg-blue-50 text-blue-700'
              }`}
              title="Satış sıralaması"
            >
              {personRank >= 0 ? `${personRank + 1}.` : '—'}
            </span>
            <div>
              <p className="text-2xl font-bold text-slate-900">{displayName(person.username)}</p>
              {personRank >= 0 && (
                <p className="text-sm text-slate-500">{people.length} kişi arasında {personRank + 1}. sırada</p>
              )}
            </div>
          </div>

          <Headline place={displayName(person.username)} period={periodText} metrics={person} />
          <NumberTiles metrics={person} />
          {person.reservations > 0 && (
            <p className={`${CARD} p-5 text-lg text-slate-700`}>
              Ayırttığı her 10 arsadan yaklaşık{' '}
              <span className="font-bold text-slate-900">{Math.min(10, Math.round((person.sales / person.reservations) * 10))}</span> tanesi
              satışa dönüştü.
            </p>
          )}

          <LandList
            title={`${displayName(person.username)} – ilgilendiği arsalar`}
            rows={personLandRows}
            status={statusFilter}
            onStatusChange={setStatusFilter}
            onOpen={openLand}
          />
        </>
      )}
    </div>
  );
}
