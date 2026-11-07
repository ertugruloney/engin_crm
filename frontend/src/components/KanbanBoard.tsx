import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Filter, Plus, RotateCcw } from 'lucide-react';
import * as xlsx from 'xlsx';
import { getLands } from '../api';
import { statusColors, statusLabels } from '../types';
import type { Land, LandStatus } from '../types';
import CreateLandModal from './CreateLandModal';
import { FILTER_FIELDS, loadFilterVisibility } from '../filterSettings';

interface LandFilters {
  il: string;
  ilce: string;
  mahalle: string;
  ada: string;
  parsel: string;
  status: LandStatus | '';
}

const EMPTY_FILTERS: LandFilters = {
  il: '',
  ilce: '',
  mahalle: '',
  ada: '',
  parsel: '',
  status: '',
};

const uniqueSorted = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

export default function KanbanBoard({ isSalesSupport = false }: { isSalesSupport?: boolean }) {
  const [showCreateLand, setShowCreateLand] = useState(false);
  const [filters, setFilters] = useState<LandFilters>(EMPTY_FILTERS);
  const [filterVisibility] = useState(loadFilterVisibility);
  const navigate = useNavigate();
  const location = useLocation();
  const openLand = (land: Land) => navigate(`/land/${land.id}`, { state: { from: location.pathname } });

  const { data: lands = [], isLoading, isError, error } = useQuery({
    queryKey: ['lands'],
    queryFn: getLands,
  });

  const districts = uniqueSorted(
    lands
      .filter(land => !filterVisibility.il || !filters.il || land.il === filters.il)
      .map(land => land.ilce),
  );
  const neighborhoods = uniqueSorted(
    lands
      .filter(land =>
        (!filterVisibility.il || !filters.il || land.il === filters.il)
        && (!filterVisibility.ilce || !filters.ilce || land.ilce === filters.ilce)
      )
      .map(land => land.mahalle),
  );

  const filteredLands = useMemo(() => lands.filter(land =>
    (!filterVisibility.il || !filters.il || land.il === filters.il)
    && (!filterVisibility.ilce || !filters.ilce || land.ilce === filters.ilce)
    && (!filterVisibility.mahalle || !filters.mahalle || land.mahalle === filters.mahalle)
    && (!(isSalesSupport || filterVisibility.ada) || !filters.ada || land.ada.toLocaleLowerCase('tr-TR').includes(filters.ada.trim().toLocaleLowerCase('tr-TR')))
    && (!(isSalesSupport || filterVisibility.parsel) || !filters.parsel || land.parsel.toLocaleLowerCase('tr-TR').includes(filters.parsel.trim().toLocaleLowerCase('tr-TR')))
    && (!filters.status || land.status === filters.status)
  ), [lands, filters, filterVisibility, isSalesSupport]);

  const hasActiveFilters = FILTER_FIELDS
    .some(field => (filterVisibility[field] || (isSalesSupport && (field === 'ada' || field === 'parsel'))) && Boolean(filters[field]))
    || Boolean(filters.status);
  const supportStatusCards: { label: string; status: LandStatus | ''; dot: string; value: number }[] = [
    { label: 'Tüm arsalar', status: '', dot: 'bg-blue-600', value: lands.length },
    { label: 'Satışa Uygun', status: 'BOS', dot: 'bg-emerald-500', value: lands.filter(land => land.status === 'BOS').length },
    { label: 'Rezerv', status: 'REZERV', dot: 'bg-amber-500', value: lands.filter(land => land.status === 'REZERV').length },
    { label: 'Kapora Alındı', status: 'KAPORA_ALINDI', dot: 'bg-blue-600', value: lands.filter(land => land.status === 'KAPORA_ALINDI').length },
    { label: 'Tapu Verildi', status: 'TAPU', dot: 'bg-gray-500', value: lands.filter(land => land.status === 'TAPU').length },
  ];

  const exportFilteredLands = () => {
    const rows = filteredLands.map(land => ({
      'İl': land.il,
      'İlçe': land.ilce,
      'Mahalle': land.mahalle,
      'Ada': land.ada,
      'Parsel': land.parsel,
      'Durum': land.status === 'TAPU' ? 'Tapu Verildi' : statusLabels[land.status],
      'Müşteri': land.customer_name || '—',
      'Telefon': land.customer_phone || '—',
      'Kapora': land.deposit_amount ? Number(land.deposit_amount) : '',
      'Satış Bedeli': land.sale_price ? Number(land.sale_price) : '',
      'Not': land.reservation_notes || '—',
    }));
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Arsalar');
    xlsx.writeFile(workbook, 'arsa-kayitlari.xlsx');
  };
  if (isLoading) return <div className="flex-1 text-center text-slate-500">Arsalar yükleniyor...</div>;
  if (isError) return <div role="alert" className="text-red-600">Arsalar yüklenemedi: {error.message}</div>;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className={`mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4 ${
        isSalesSupport ? '' : 'rounded-2xl border border-transparent p-5'
      }`}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">
            {isSalesSupport ? 'Satış Destek Panosu' : 'Satış Panosu'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSalesSupport
              ? 'Arsaları duruma göre görmek için kartlara tıklayın.'
              : 'Arsaları tablo üzerinden görüntüleyin ve yönetin.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateLand(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus size={18} />
          {isSalesSupport ? 'Yeni Arsa Ekle' : 'Boş Arsa Ekle'}
        </button>
      </div>

      {isSalesSupport && (
        <section aria-label="Arsa durumu özeti" className="mb-4 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {supportStatusCards.map(({ label, status, dot, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilters(current => ({ ...current, status }))}
              aria-pressed={filters.status === status}
              className={`min-w-0 rounded-xl border bg-white px-3 py-2.5 text-left transition-colors sm:px-4 ${
                filters.status === status
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="flex items-center gap-2 truncate text-xs font-medium text-slate-500">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                {label}
              </span>
              <span className="mt-1 block text-2xl font-bold leading-none text-slate-800">{value}</span>
            </button>
          ))}
        </section>
      )}

      <section aria-label="Arsa filtreleri" className={`mb-4 shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 ${isSalesSupport ? '' : 'mb-5'}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {!isSalesSupport && (
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter size={16} className="text-slate-500" />
              Arsaları filtrele
            </div>
          )}
          <div className="flex items-center gap-3">
            {!isSalesSupport && <span className="text-xs text-slate-500">{filteredLands.length} arsa bulundu</span>}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <RotateCcw size={13} />
                Filtreleri temizle
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
          {filterVisibility.il && (
            <label className="text-xs font-medium text-slate-600">
              İl
              <select
                value={filters.il}
                onChange={event => setFilters(current => ({ ...current, il: event.target.value, ilce: '', mahalle: '' }))}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Tüm iller</option>
                {uniqueSorted(lands.map(land => land.il)).map(il => <option key={il} value={il}>{il}</option>)}
              </select>
            </label>
          )}
          {filterVisibility.ilce && (
            <label className="text-xs font-medium text-slate-600">
              İlçe
              <select
                value={filters.ilce}
                onChange={event => setFilters(current => ({ ...current, ilce: event.target.value, mahalle: '' }))}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Tüm ilçeler</option>
                {districts.map(ilce => <option key={ilce} value={ilce}>{ilce}</option>)}
              </select>
            </label>
          )}
          {filterVisibility.mahalle && (
            <label className="text-xs font-medium text-slate-600">
              Mahalle
              <select
                value={filters.mahalle}
                onChange={event => setFilters(current => ({ ...current, mahalle: event.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Tüm mahalleler</option>
                {neighborhoods.map(mahalle => <option key={mahalle} value={mahalle}>{mahalle}</option>)}
              </select>
            </label>
          )}
          {(isSalesSupport || filterVisibility.ada) && (
            <label className="text-xs font-medium text-slate-600">
              Ada
              <input
                type="search"
                value={filters.ada}
                onChange={event => setFilters(current => ({ ...current, ada: event.target.value }))}
                placeholder="Ada no"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
              />
            </label>
          )}
          {(isSalesSupport || filterVisibility.parsel) && (
            <label className="text-xs font-medium text-slate-600">
              Parsel
              <input
                type="search"
                value={filters.parsel}
                onChange={event => setFilters(current => ({ ...current, parsel: event.target.value }))}
                placeholder="Parsel no"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
              />
            </label>
          )}
          {!isSalesSupport && (
            <label className="text-xs font-medium text-slate-600">
              Durum
              <select
                value={filters.status}
                onChange={event => setFilters(current => ({
                  ...current,
                  status: event.target.value as LandStatus | '',
                }))}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Tüm durumlar</option>
                {(Object.entries(statusLabels) as [LandStatus, string][]).map(([status, label]) => (
                  <option key={status} value={status}>{label}</option>
                ))}
              </select>
            </label>
          )}
          {isSalesSupport && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
              }}
              className="self-end rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Filtreleri temizle
            </button>
          )}
        </div>
      </section>

      {isSalesSupport ? (
      <section aria-live="polite" className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Arsa Kayıtları</h2>
            <p className="mt-0.5 text-xs text-slate-500">{filteredLands.length} arsa gösteriliyor</p>
          </div>
          <button
            type="button"
            onClick={exportFilteredLands}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Download size={16} />
            Excel'e aktar
          </button>
        </div>
        <table className="w-full table-fixed border-collapse text-left text-sm md:min-w-[900px] md:table-auto">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th className="w-[34%] border-b border-slate-200 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:w-auto md:px-4">Konum</th>
              <th className="w-[12%] border-b border-slate-200 px-1 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:w-auto md:px-4">Ada</th>
              <th className="w-[12%] border-b border-slate-200 px-1 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:w-auto md:px-4">Parsel</th>
              <th className="w-[26%] border-b border-slate-200 px-2 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:w-auto md:px-4">Durum</th>
              <th className="hidden border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Müşteri</th>
              <th className="hidden border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Telefon</th>
              <th className="hidden border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Not</th>
              <th className="w-[16%] border-b border-slate-200 px-1 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 md:w-auto md:px-4">Aç</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-300">
            {filteredLands.map(land => (
              <tr key={land.id} className={land.status === 'BOS' ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-blue-50/60'}>
                <td className="px-3 py-3 md:px-4">
                  <span className="block truncate font-medium text-slate-800">{land.ilce}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{land.mahalle} · {land.il}</span>
                </td>
                <td className="break-words px-1 py-3 font-mono text-xs text-slate-700 md:whitespace-nowrap md:px-4 md:text-sm">{land.ada}</td>
                <td className="break-words px-1 py-3 font-mono text-xs text-slate-700 md:whitespace-nowrap md:px-4 md:text-sm">{land.parsel}</td>
                <td className="px-2 py-3 md:px-4">
                  <span className={`inline-block max-w-full whitespace-normal rounded-full border px-2 py-1 text-center text-[10px] font-semibold leading-tight md:px-2.5 md:text-xs ${statusColors[land.status]}`}>
                    {land.status === 'TAPU' ? 'Tapu Verildi' : statusLabels[land.status]}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.customer_name || '—'}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.customer_phone || '—'}</td>
                <td className="hidden max-w-64 px-4 py-3 text-slate-700 md:table-cell">
                  <span className="block truncate" title={land.reservation_notes || 'Not eklenmemiş'}>{land.reservation_notes || '—'}</span>
                </td>
                <td className="px-1 py-3 text-center md:px-4">
                  <button
                    type="button"
                  onClick={() => openLand(land)}
                    className="min-w-16 rounded-lg bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                    aria-label={`${land.ada} ada ${land.parsel} parsel detaylarını aç`}
                  >
                    Aç
                  </button>
                </td>
              </tr>
            ))}
            {filteredLands.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">Filtre kriterlerinize uygun arsa bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </section>
      ) : (
      <section aria-live="polite" className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold text-slate-800">Arsalar</h2>
          <span className="text-sm text-slate-500">{filteredLands.length} arsa</span>
        </div>
        <table className="w-full table-fixed border-collapse text-left text-sm md:table-auto md:min-w-[1500px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th className="w-[65%] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:hidden">
                Arsa
              </th>
              <th className="w-[35%] border-b border-slate-200 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:hidden">
                Durum
              </th>
              {['İl', 'İlçe', 'Mahalle', 'Ada', 'Parsel', 'Durum', 'Müşteri', 'Telefon', 'Not'].map(label => (
                <th key={label} className="hidden border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-300">
            {filteredLands.map(land => (
              <tr
                key={land.id}
                tabIndex={0}
                role="button"
                onClick={() => openLand(land)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openLand(land);
                  }
                }}
                className={`cursor-pointer transition-colors focus:outline-none ${
                  land.status === 'BOS'
                    ? 'bg-green-50 hover:bg-green-100 focus:bg-green-100'
                    : 'hover:bg-blue-50/60 focus:bg-blue-50'
                }`}
                aria-label={`${land.il}, ${land.ilce}, ${land.mahalle}, ada ${land.ada}, parsel ${land.parsel}; detayları aç`}
              >
                <td className="break-words px-3 py-3 md:hidden">
                  <span className="block font-medium text-slate-800">Ada {land.ada} / Parsel {land.parsel}</span>
                  <span className="mt-1 block text-xs text-slate-600">{land.il}, {land.ilce}, {land.mahalle}</span>
                  {land.customer_name && <span className="mt-1 block truncate text-xs text-slate-500">{land.customer_name}</span>}
                </td>
                <td className="px-2 py-3 md:hidden">
                  <span className={`inline-block max-w-full whitespace-normal rounded-full border px-2 py-1 text-center text-[11px] font-semibold leading-tight ${statusColors[land.status]}`}>
                    {statusLabels[land.status]}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 font-medium text-slate-800 md:table-cell">{land.il}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.ilce}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.mahalle}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-slate-700 md:table-cell">{land.ada}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 font-mono font-medium text-slate-800 md:table-cell">{land.parsel}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 md:table-cell">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColors[land.status]}`}>
                    {statusLabels[land.status]}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.customer_name || '—'}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-700 md:table-cell">{land.customer_phone || '—'}</td>
                <td className="hidden max-w-64 px-4 py-3 text-slate-700 md:table-cell">
                  <span className="block truncate" title={land.reservation_notes || 'Not eklenmemiş'}>
                    {land.reservation_notes || '—'}
                  </span>
                </td>
              </tr>
            ))}
            {filteredLands.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-slate-500 md:hidden">
                  Filtre kriterlerinize uygun arsa bulunamadı.
                </td>
                <td colSpan={9} className="hidden px-4 py-12 text-center text-slate-500 md:table-cell">
                  Filtre kriterlerinize uygun arsa bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Durum, müşteri bilgileri, notlar ve arsa işlemleri için satıra tıklayın.
        </p>
      </section>
        )}

      {showCreateLand && <CreateLandModal onClose={() => setShowCreateLand(false)} />}
    </div>
  );
}
