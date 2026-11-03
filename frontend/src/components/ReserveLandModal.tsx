import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { reserveLand } from '../api';
import type { RepresentativeLand } from '../api';
import PhoneNumberInput from './PhoneNumberInput';
import { formatInternationalPhone, getPhoneValidationError } from '../phoneNumber';
import type { CountryCode } from 'libphonenumber-js';

interface ReserveLandModalProps {
  land: RepresentativeLand;
  onClose: () => void;
}

export default function ReserveLandModal({ land, onClose }: ReserveLandModalProps) {
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('TR');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneSubmitAttempted, setPhoneSubmitAttempted] = useState(false);
  const phoneError = phoneTouched || phoneSubmitAttempted
    ? getPhoneValidationError(customerPhone, phoneCountry)
    : null;

  const mutation = useMutation({
    mutationFn: () => reserveLand(land.id, {
      customer_name: customerName.trim(),
      customer_phone: formatInternationalPhone(customerPhone, phoneCountry),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['representativeLands'] });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !mutation.isPending) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reserve-land-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 id="reserve-land-title" className="text-xl font-bold text-slate-800">Arsayı rezerve et</h2>
            <p className="mt-1 text-sm text-slate-500">
              {land.il}, {land.ilce}, {land.mahalle} · Ada {land.ada} / Parsel {land.parsel}
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
        </div>

        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            setPhoneSubmitAttempted(true);
            if (getPhoneValidationError(customerPhone, phoneCountry)) return;
            mutation.mutate();
          }}
        >
          <label className="block text-sm font-medium text-slate-700">
            Müşteri adı soyadı
            <input
              required
              maxLength={200}
              value={customerName}
              onChange={event => setCustomerName(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Telefon
            <PhoneNumberInput
              value={customerPhone}
              country={phoneCountry}
              onChange={setCustomerPhone}
              onCountryChange={setPhoneCountry}
              onBlur={() => setPhoneTouched(true)}
              error={phoneError}
            />
          </label>
          {errorMessage && <p role="alert" className="text-sm text-red-600">{errorMessage}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Kaydediliyor...' : 'Rezervasyonu kaydet'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
