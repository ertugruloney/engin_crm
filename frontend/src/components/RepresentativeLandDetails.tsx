import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Phone, X } from 'lucide-react';
import { updateRepresentativeLandNotes } from '../api';
import type { RepresentativeLand } from '../api';
import { statusColors, statusLabels } from '../types';
import LandHistory from './LandHistory';

interface RepresentativeLandDetailsProps {
  land: RepresentativeLand;
  canViewReservationDetails: boolean;
  onClose: () => void;
  onReserve: (land: RepresentativeLand) => void;
}

export default function RepresentativeLandDetails({
  land,
  canViewReservationDetails,
  onClose,
  onReserve,
}: RepresentativeLandDetailsProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(land.reservation_notes || '');
  const mutation = useMutation({
    mutationFn: () => updateRepresentativeLandNotes(land.id, notes),
    onSuccess: async updatedLand => {
      queryClient.setQueryData<RepresentativeLand[]>(['representativeLands'], current =>
        current?.map(item => item.id === updatedLand.id ? updatedLand : item),
      );
      await queryClient.invalidateQueries({ queryKey: ['representativeLands'] });
      await queryClient.invalidateQueries({ queryKey: ['landHistory', updatedLand.id] });
      onClose();
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
              Ada {land.ada} / Parsel {land.parsel}
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

          {canViewReservationDetails ? <form
            onSubmit={event => {
              event.preventDefault();
              mutation.mutate();
            }}
            className="space-y-3"
          >
            <label htmlFor="representative-land-notes" className="block font-semibold text-slate-800">
              Arsa notu
            </label>
            <textarea
              id="representative-land-notes"
              rows={6}
              maxLength={10000}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Arsayla ilgili notları yazın..."
              className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {errorMessage && <p role="alert" className="text-sm text-red-600">Not kaydedilemedi: {errorMessage}</p>}
            <button
              type="submit"
              disabled={mutation.isPending || notes === (land.reservation_notes || '')}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? 'Kaydediliyor...' : 'Notu kaydet'}
            </button>
          </form> : (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              Arsa notları ve rezervasyon bilgileri yönetici ayarları nedeniyle gizlenmiştir.
            </p>
          )}

          {land.status === 'BOS' && (
            <button
              type="button"
              onClick={() => onReserve(land)}
              className="w-full rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              Bu arsayı rezerve et
            </button>
          )}

          <LandHistory landId={land.id} />
        </div>
      </section>
    </div>
  );
}
