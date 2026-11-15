import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Phone, X } from 'lucide-react';
import { addRepresentativeLandNote } from '../api';
import type { RepresentativeLand } from '../api';
import { statusColors, statusLabels, parcelLabel } from '../types';
import LandLocationCard from './LandLocationCard';
import type { ReserveLandMode } from './ReserveLandModal';

interface RepresentativeLandDetailsProps {
  land: RepresentativeLand;
  canViewReservationDetails: boolean;
  // Arsa notlarını görme ve not ekleme (Django yönetim panelindeki ayar); müşteri bilgilerinden bağımsız.
  canAddNotes: boolean;
  onClose: () => void;
  onReserve: (land: RepresentativeLand, mode: ReserveLandMode) => void;
}

export default function RepresentativeLandDetails({
  land,
  canViewReservationDetails,
  canAddNotes,
  onClose,
  onReserve,
}: RepresentativeLandDetailsProps) {
  const queryClient = useQueryClient();
  // Kapora rezervdeki arsada alınır (kim rezerve etmiş olursa olsun); satışa uygun arsada önce rezerv gerekir.
  const canTakeDeposit = land.status === 'REZERV' && Boolean(land.can_take_deposit);
  // Mevcut notlar salt okunur; temsilci yalnızca yeni not ekler (tarih ve kullanıcı adıyla sona yazılır).
  const [existingNotes, setExistingNotes] = useState(land.reservation_notes || '');
  const [newNote, setNewNote] = useState('');
  const mutation = useMutation({
    mutationFn: () => addRepresentativeLandNote(land.id, newNote.trim()),
    onSuccess: async updatedLand => {
      setExistingNotes(updatedLand.reservation_notes || '');
      setNewNote('');
      queryClient.setQueryData<RepresentativeLand[]>(['representativeLands'], current =>
        current?.map(item => item.id === updatedLand.id ? updatedLand : item),
      );
      await queryClient.invalidateQueries({ queryKey: ['representativeLands'] });
    },
  });

  const errorMessage = mutation.error
    ? isAxiosError<Record<string, unknown>>(mutation.error)
      ? Object.values(mutation.error.response?.data || {})
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        || mutation.error.message
      : mutation.error.message
    : null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-sm"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !mutation.isPending) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="representative-land-details-title"
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <h2 id="representative-land-details-title" className="text-2xl font-bold text-slate-800">
              {parcelLabel(land)}
            </h2>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
              <MapPin size={14} />
              {land.il}, {land.ilce}, {land.mahalle}
            </p>
          </div>
          <button
            type="button"
            aria-label="Kapat"
            disabled={mutation.isPending}
            onClick={onClose}
            className="rounded-full border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
            <span className="text-sm font-medium text-slate-600">Arsa durumu</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusColors[land.status]}`}>
              {statusLabels[land.status]}
            </span>
          </div>

          <LandLocationCard land={land} canEdit={false} />

          {canViewReservationDetails && land.status !== 'BOS' && (
            <section className="space-y-4">
              <h3 className="font-semibold text-slate-800">Rezervasyon bilgileri</h3>
              <p className="text-sm font-medium text-slate-700">{land.customer_name || 'Müşteri belirtilmedi'}</p>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {land.customer_phone && (
                  <p className="flex items-center gap-2 text-slate-600">
                    <Phone size={14} className="text-slate-400" />
                    {land.customer_phone}
                  </p>
                )}
              </div>
            </section>
          )}

          {canAddNotes ? (
            <section className="space-y-3">
              <h3 className="font-semibold text-slate-800">Arsa notları</h3>
              {existingNotes.trim() ? (
                <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {existingNotes}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Bu arsaya henüz not eklenmemiş.</p>
              )}
              <form
                onSubmit={event => {
                  event.preventDefault();
                  if (newNote.trim()) mutation.mutate();
                }}
                className="space-y-2"
              >
                <label htmlFor="representative-land-note" className="sr-only">Yeni not</label>
                <textarea
                  id="representative-land-note"
                  rows={3}
                  maxLength={2000}
                  value={newNote}
                  onChange={event => setNewNote(event.target.value)}
                  placeholder="Yeni not yazın (ör. müşteri hafta sonu yeri görmeye gelecek)..."
                  className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                {errorMessage && <p role="alert" className="text-sm text-red-600">Not eklenemedi: {errorMessage}</p>}
                {mutation.isSuccess && !newNote && <p role="status" className="text-sm text-emerald-700">Not eklendi.</p>}
                <button
                  type="submit"
                  disabled={mutation.isPending || !newNote.trim()}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mutation.isPending ? 'Ekleniyor...' : 'Notu ekle'}
                </button>
                <p className="text-[11px] text-slate-400">Not, tarih ve kullanıcı adınızla eklenir; mevcut notlar değiştirilemez.</p>
              </form>
            </section>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              Arsa notları yönetici ayarları nedeniyle gizlenmiştir.
            </p>
          )}

          {(land.status === 'BOS' || canTakeDeposit) && (
            <div className="space-y-2">
              {land.status === 'BOS' && (
                <button
                  type="button"
                  onClick={() => onReserve(land, 'reserve')}
                  className="w-full rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Bu arsayı rezerve et
                </button>
              )}
              {canTakeDeposit && (
                <button
                  type="button"
                  onClick={() => onReserve(land, 'deposit')}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Kapora alındı
                </button>
              )}
            </div>
          )}

        </div>
      </section>
    </div>
  );
}
