import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { reserveLand, takeLandDeposit } from '../api';
import type { RepresentativeLand } from '../api';
import { parcelLabel } from '../types';
import PhoneNumberInput from './PhoneNumberInput';
import { formatInternationalPhone, getPhoneValidationError } from '../phoneNumber';
import type { CountryCode } from 'libphonenumber-js';
import { EMPTY_ID_IMAGES, IdImageFields, idImagesError } from './IdImageFields';
import type { IdImages } from './IdImageFields';

export type ReserveLandMode = 'reserve' | 'deposit';

interface ReserveLandModalProps {
  land: RepresentativeLand;
  // reserve: boş arsayı rezerve eder; deposit: rezervdeki arsayı kapora tutarıyla "Kapora Alındı"ya geçirir.
  mode?: ReserveLandMode;
  onClose: () => void;
}

/** "25.000,50" ya da "25000.50" gibi girişleri API'nin beklediği "25000.50" biçimine çevirir. */
const normalizeAmount = (value: string) => {
  const raw = value.trim().replace(/[^\d,.]/g, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const amount = Number(normalized);
  return normalized && Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null;
};

export default function ReserveLandModal({ land, mode = 'reserve', onClose }: ReserveLandModalProps) {
  const queryClient = useQueryClient();
  const isDeposit = mode === 'deposit';
  // Kapora yalnızca rezerve arsada alınır; müşteri rezervasyonda girildiği için yalnızca tutar istenir.
  const needsCustomer = !isDeposit;
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('TR');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneSubmitAttempted, setPhoneSubmitAttempted] = useState(false);
  const [depositText, setDepositText] = useState('');
  const [depositError, setDepositError] = useState<string | null>(null);
  // Kapora adımında kimliğin ön ve arka yüz fotoğrafı zorunludur.
  const [idImages, setIdImages] = useState<IdImages>(EMPTY_ID_IMAGES);
  const [idImagesSubmitAttempted, setIdImagesSubmitAttempted] = useState(false);
  const phoneError = needsCustomer && (phoneTouched || phoneSubmitAttempted)
    ? getPhoneValidationError(customerPhone, phoneCountry)
    : null;

  const mutation = useMutation({
    mutationFn: () => {
      const customer = {
        customer_name: customerName.trim(),
        customer_phone: formatInternationalPhone(customerPhone, phoneCountry),
      };
      if (!isDeposit) return reserveLand(land.id, customer);
      if (!idImages.front || !idImages.back) throw new Error('Kimliğin ön ve arka yüz fotoğraflarını yükleyin.');
      return takeLandDeposit(land.id, {
        deposit_amount: normalizeAmount(depositText) ?? '',
        id_front_image: idImages.front,
        id_back_image: idImages.back,
      });
    },
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

  const title = isDeposit ? 'Kapora alındı olarak kaydet' : 'Arsayı rezerve et';
  const submitLabel = isDeposit ? 'Kaporayı kaydet' : 'Rezervasyonu kaydet';

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
            <h2 id="reserve-land-title" className="text-xl font-bold text-slate-800">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {land.il}, {land.ilce}, {land.mahalle} · {parcelLabel(land)}
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
            if (needsCustomer) {
              setPhoneSubmitAttempted(true);
              if (getPhoneValidationError(customerPhone, phoneCountry)) return;
            }
            if (isDeposit) {
              const amountError = normalizeAmount(depositText) ? null : 'Sıfırdan büyük bir kapora tutarı girin.';
              setDepositError(amountError);
              setIdImagesSubmitAttempted(true);
              if (amountError || idImagesError(idImages, true)) return;
            }
            mutation.mutate();
          }}
        >
          {needsCustomer ? (
            <>
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
            </>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Kapora, bu arsadaki mevcut rezervasyonun müşterisi adına kaydedilir
              {land.customer_name ? <> (<span className="font-medium text-slate-800">{land.customer_name}</span>)</> : null}.
            </p>
          )}
          {isDeposit && (
            <label className="block text-sm font-medium text-slate-700">
              Kapora tutarı (₺)
              <input
                required
                inputMode="decimal"
                value={depositText}
                onChange={event => {
                  setDepositText(event.target.value);
                  setDepositError(null);
                }}
                placeholder="ör. 25.000"
                aria-invalid={Boolean(depositError)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              {depositError && <span className="mt-1 block text-xs text-red-600">{depositError}</span>}
            </label>
          )}
          {isDeposit && (
            <IdImageFields
              value={idImages}
              onChange={setIdImages}
              required
              showError={idImagesSubmitAttempted}
            />
          )}
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
              {mutation.isPending ? 'Kaydediliyor...' : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
