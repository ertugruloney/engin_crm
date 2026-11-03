import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { createLand } from '../api';
import type { NewLand } from '../api';

interface CreateLandModalProps {
  onClose: () => void;
}

const initialForm: NewLand = {
  il: '',
  ilce: '',
  mahalle: '',
  ada: '',
  parsel: '',
  status: 'BOS',
  reservation_notes: '',
  deposit_amount: null,
};

export default function CreateLandModal({ onClose }: CreateLandModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);

  const mutation = useMutation({
    mutationFn: createLand,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lands'] });
      onClose();
    },
  });

  const setField = (field: keyof NewLand, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !mutation.isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-land-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 id="create-land-title" className="text-xl font-bold text-slate-800">Boş Arsa Ekle</h2>
            <p className="mt-1 text-sm text-slate-500">Arsa bilgilerini girerek panoya yeni kart ekleyin.</p>
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
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {([
              ['il', 'İl'],
              ['ilce', 'İlçe'],
              ['mahalle', 'Mahalle'],
              ['ada', 'Ada'],
              ['parsel', 'Parsel'],
            ] as const).map(([field, label]) => (
              <label key={field} className="block text-sm font-medium text-slate-700">
                {label}
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form[field]}
                  onChange={event => setField(field, event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            ))}
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Not (isteğe bağlı)
            <textarea
              rows={3}
              value={form.reservation_notes}
              onChange={event => setField('reservation_notes', event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {mutation.isError && (
            <p role="alert" className="text-sm text-red-600">
              Arsa kaydedilemedi: {mutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Kaydediliyor...' : 'Boş Arsa Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
