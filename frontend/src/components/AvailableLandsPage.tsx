import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { getRepresentativeLands, getRepresentativeSettings } from '../api';
import type { RepresentativeLand } from '../api';
import { statusColors, statusLabels } from '../types';
import type { LandStatus } from '../types';
import RepresentativeLandDetails from './RepresentativeLandDetails';
import ReserveLandModal from './ReserveLandModal';

interface SearchFields {
  il: string;
  ilce: string;
  mahalle: string;
  ada: string;
  parsel: string;
  status: LandStatus | '';
}

const EMPTY_SEARCH: SearchFields = {
  il: '',
  ilce: '',
  mahalle: '',
  ada: '',
  parsel: '',
  status: '',
};

const uniqueSorted = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

export default function AvailableLandsPage() {
  const [search, setSearch] = useState<SearchFields>(EMPTY_SEARCH);
  const [submittedSearch, setSubmittedSearch] = useState<SearchFields | null>(null);
  const [selectedLand, setSelectedLand] = useState<RepresentativeLand | null>(null);
  const [landToReserve, setLandToReserve] = useState<RepresentativeLand | null>(null);
  const { data: lands = [], isLoading, isError, error } = useQuery({
    queryKey: ['representativeLands'],
    queryFn: getRepresentativeLands,
  });
  const {
    data: representativeSettings,
    isLoading: isSettingsLoading,
    isError: isSettingsError,
    error: settingsError,
  } = useQuery({
    queryKey: ['representativeSettings'],
    queryFn: getRepresentativeSettings,
  });

  const districts = uniqueSorted(
    lands.filter(land => !search.il || land.il === search.il).map(land => land.ilce),
  );
  const neighborhoods = uniqueSorted(
    lands
      .filter(land =>
        (!search.il || land.il === search.il)
        && (!search.ilce || land.ilce === search.ilce)
      )
      .map(land => land.mahalle),
  );

  const results = useMemo(() => {
    if (!submittedSearch) return [];
    return lands.filter(land =>
      (!submittedSearch.il || land.il === submittedSearch.il)
      && (!submittedSearch.ilce || land.ilce === submittedSearch.ilce)
      && (!submittedSearch.mahalle || land.mahalle === submittedSearch.mahalle)
      && (!submittedSearch.ada || land.ada.toLocaleLowerCase('tr-TR').includes(submittedSearch.ada.trim().toLocaleLowerCase('tr-TR')))
      && (!submittedSearch.parsel || land.parsel.toLocaleLowerCase('tr-TR').includes(submittedSearch.parsel.trim().toLocaleLowerCase('tr-TR')))
      && (!submittedSearch.status || land.status === submittedSearch.status)
    );
  }, [lands, submittedSearch]);

  if (isLoading) return <div className="flex-1 text-center text-slate-500">Arsalar yükleniyor...</div>;
  if (isError) return <div role="alert" className="text-red-600">Arsalar yüklenemedi: {error.message}</div>;
  if (isSettingsLoading) return <div className="flex-1 text-center text-slate-500">Görünürlük ayarları yükleniyor...</div>;
  if (isSettingsError) return <div role="alert" className="text-red-600">Görünürlük ayarları yüklenemedi: {settingsError.message}</div>;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-800">Arsalar</h1>
        <p className="mt-1 text-slate-500">İl, ilçe, mahalle, ada/parsel ve durum bilgileriyle arayın.</p>
      </div>

      <form
        onSubmit={event => {
          event.preventDefault();
          setSubmittedSearch(search);
        }}
        className="mb-6 shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <MapPin size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Arsa ara</h2>
            <p className="text-xs text-slate-500">Konum veya ada/parsel bilgilerini seçin.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-medium text-slate-600">
            İl
            <select
              value={search.il}
              onChange={event => setSearch(current => ({ ...current, il: event.target.value, ilce: '', mahalle: '' }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
            >
              <option value="">Tüm iller</option>
              {uniqueSorted(lands.map(land => land.il)).map(il => <option key={il} value={il}>{il}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            İlçe
            <select
              value={search.ilce}
              onChange={event => setSearch(current => ({ ...current, ilce: event.target.value, mahalle: '' }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
            >
              <option value="">Tüm ilçeler</option>
              {districts.map(ilce => <option key={ilce} value={ilce}>{ilce}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Mahalle
            <select
              value={search.mahalle}
              onChange={event => setSearch(current => ({ ...current, mahalle: event.target.value }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
            >
              <option value="">Tüm mahalleler</option>
              {neighborhoods.map(mahalle => <option key={mahalle} value={mahalle}>{mahalle}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Ada
            <input
              value={search.ada}
              onChange={event => setSearch(current => ({ ...current, ada: event.target.value }))}
              placeholder="Ada no"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Parsel
            <input
              value={search.parsel}
              onChange={event => setSearch(current => ({ ...current, parsel: event.target.value }))}
              placeholder="Parsel no"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Durum
            <select
              value={search.status}
              onChange={event => setSearch(current => ({
                ...current,
                status: event.target.value as LandStatus | '',
              }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
            >
              <option value="">Tüm durumlar</option>
              {(Object.entries(statusLabels) as [LandStatus, string][]).map(([status, label]) => (
                <option key={status} value={status}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => {
              setSearch(EMPTY_SEARCH);
              setSubmittedSearch(null);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Temizle
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Search size={16} />
            Arsaları ara
          </button>
        </div>
      </form>

      {submittedSearch ? (
        <section aria-live="polite" className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 className="font-semibold text-slate-800">Arama sonuçları</h2>
            <span className="text-sm text-slate-500">{results.length} arsa bulundu</span>
          </div>
          <table className="w-full table-fixed border-collapse text-left text-sm md:table-auto md:min-w-[1120px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <th className="w-[65%] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:hidden">
                  Arsa
                </th>
                <th className="w-[35%] border-b border-slate-200 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:hidden">
                  Durum
                </th>
                {['İl', 'İlçe', 'Mahalle', 'Ada', 'Parsel', 'Durum'].map(label => (
                  <th key={label} className="hidden border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-300">
              {results.map(land => (
                <tr
                  key={land.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedLand(land)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedLand(land);
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
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-12 text-center text-slate-500 md:hidden">
                    Arama kriterlerinize uygun arsa bulunamadı.
                  </td>
                  <td colSpan={6} className="hidden px-4 py-12 text-center text-slate-500 md:table-cell">
                    Arama kriterlerinize uygun arsa bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            Arsa bilgileri, notlar ve izin verilen işlemler için satıra tıklayın.
          </p>
        </section>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Search size={21} />
          </div>
          <p className="font-medium text-slate-700">Arama bilgilerini girin</p>
          <p className="mt-1 text-sm text-slate-500">Eşleşen boş ve rezerve arsalar satır satır listelenecek.</p>
        </div>
      )}

      {selectedLand && (
        <RepresentativeLandDetails
          land={selectedLand}
          canViewReservationDetails={representativeSettings?.can_view_reservation_details ?? false}
          onClose={() => setSelectedLand(null)}
          onReserve={land => {
            setSelectedLand(null);
            setLandToReserve(land);
          }}
        />
      )}
      {landToReserve && <ReserveLandModal land={landToReserve} onClose={() => setLandToReserve(null)} />}
    </div>
  );
}
