import { useState } from 'react';
import { createPortal } from 'react-dom';
import { isAxiosError } from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { X, MapPin, CheckCircle2, Circle, Pencil, UserRound, RotateCcw, ArrowLeft, ImagePlus, Download, History } from 'lucide-react';
import { statusLabels } from '../types';
import type { Land, LandInstallment, LandStatus } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { downloadTitleDeedImage, getLandStatusUpdate, updateLandStatus } from '../api';
import type { CancelDetail, CancelReason, LandUpdate } from '../api';
import { CANCEL_REASON_TREE } from '../customerDisplay';
import PhoneNumberInput from './PhoneNumberInput';
import LandLocationCard from './LandLocationCard';
import { formatInternationalPhone, getPhoneValidationError, splitPhoneNumber } from '../phoneNumber';
import type { CountryCode } from 'libphonenumber-js';

interface DrawerProps {
  land: Land | null;
  onClose: () => void;
  embedded?: boolean;
  onHistoryClick?: () => void;
}

const STAGES: LandStatus[] = ['BOS', 'REZERV', 'KAPORA_ALINDI', 'TAPU'];

type ReservationForm = Pick<
  Land,
  | 'customer_name'
  | 'customer_phone'
>;

const formatTransitionDate = (date: string) =>
  new Date(date).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

const formatCurrency = (amount: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(amount));

const getDefaultInstallmentDate = () => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
};

const createInstallmentPlan = (
  salePrice: string,
  depositAmount: string | null,
  count: number,
  firstDate: string,
): LandInstallment[] => {
  const totalCents = Math.round(Number(salePrice) * 100) - Math.round(Number(depositAmount || 0) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0 || !Number.isInteger(count) || count < 1 || !firstDate) return [];

  const [year, month, day] = firstDate.split('-').map(Number);
  const firstDateValue = new Date(year, month - 1, day);
  if (Number.isNaN(firstDateValue.getTime())) return [];

  const baseCents = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => {
    const dueDate = new Date(year, month - 1 + index, 1);
    const monthLastDay = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate();
    dueDate.setDate(Math.min(day, monthLastDay));
    const amountCents = index === count - 1 ? totalCents - baseCents * (count - 1) : baseCents;
    return {
      due_date: `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`,
      amount: (amountCents / 100).toFixed(2),
    };
  });
};

const sumInstallments = (plan: LandInstallment[]) =>
  plan.reduce((total, item) => total + Math.round(Number(item.amount) * 100), 0);

// Sunucunun alan bazlı hata mesajlarını tek metne çevirir.
const apiErrorText = (error: unknown) => {
  if (isAxiosError<Record<string, unknown>>(error) && error.response?.data) {
    const messages = Object.values(error.response.data).flatMap(value => (Array.isArray(value) ? value : [value]));
    const text = messages.filter((value): value is string => typeof value === 'string').join(' ');
    if (text) return text;
  }
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
};

// Arsa boşa alınırken iptal nedenini sorar; müşterisi olan arsada neden seçmek zorunludur.
function CancelLandDialog({
  land,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  land: Land;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: CancelReason | undefined, detail: CancelDetail | undefined, note: string) => void;
}) {
  const [reason, setReason] = useState<CancelReason | ''>('');
  const [detail, setDetail] = useState<CancelDetail | ''>('');
  const [note, setNote] = useState('');
  const hasCustomer = Boolean(land.customer_name);
  const selected = CANCEL_REASON_TREE.find(item => item.value === reason);
  const detailRequired = Boolean(selected?.details.length);
  const noteRequired = reason === 'diger';
  const canConfirm =
    !isPending &&
    (!hasCustomer || reason !== '') &&
    (!detailRequired || detail !== '') &&
    (!noteRequired || note.trim() !== '');

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-land-title"
        onSubmit={event => {
          event.preventDefault();
          if (canConfirm) onConfirm(reason || undefined, detail || undefined, note.trim());
        }}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="cancel-land-title" className="text-xl font-bold text-slate-900">Arsayı boşa al</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ada {land.ada} / Parsel {land.parsel}
              {hasCustomer && <> · <span className="font-medium text-slate-700">{land.customer_name}</span></>}
            </p>
          </div>
          <button
            type="button"
            aria-label="Kapat"
            disabled={isPending}
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-slate-700">
            Müşteri neden vazgeçti?{' '}
            {hasCustomer ? <span className="text-red-600">(zorunlu)</span> : <span className="font-normal text-slate-400">(isteğe bağlı)</span>}
          </legend>
          <div className="mt-2 space-y-2">
            {CANCEL_REASON_TREE.filter(item => item.value !== 'devredildi').map(item => {
              const isSelected = reason === item.value;
              return (
                <div
                  key={item.value}
                  className={`rounded-xl border transition-colors ${
                    isSelected ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-400' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={item.value}
                      checked={isSelected}
                      onChange={() => {
                        setReason(item.value);
                        setDetail('');
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
                    />
                    <span>
                      <span className={`block text-sm ${isSelected ? 'font-semibold text-rose-800' : 'font-medium text-slate-800'}`}>
                        {item.label}
                      </span>
                      <span className="block text-xs text-slate-500">{item.hint}</span>
                    </span>
                  </label>
                  {isSelected && item.details.length > 0 && (
                    <div role="radiogroup" aria-label={`${item.label} – alt seçim`} className="flex flex-wrap gap-2 px-3 pb-3 pl-9">
                      {item.details.map(sub => (
                        <button
                          key={sub.value}
                          type="button"
                          role="radio"
                          aria-checked={detail === sub.value}
                          onClick={() => setDetail(sub.value)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                            detail === sub.value
                              ? 'bg-rose-600 text-white'
                              : 'bg-white text-slate-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {detailRequired && !detail && <p className="mt-2 text-xs text-rose-700">Lütfen bir alt seçim yapın.</p>}
        </fieldset>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Açıklama {noteRequired ? <span className="text-red-600">(zorunlu)</span> : <span className="font-normal text-slate-400">(isteğe bağlı)</span>}
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Örn. Kredi onayı çıkmadı, 2 ay sonra tekrar aranacak."
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Arsa satışa açılır; rezervasyon, kapora ve müşteri bilgisi arsadan silinir. Müşteri kartı ve bu iptal kaydı
          Müşteriler sayfasında kalır.
        </p>
        {error !== null && error !== undefined && <p role="alert" className="mt-3 text-sm text-red-600">{apiErrorText(error)}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="flex-1 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Boşa alınıyor...' : 'Boşa al'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default function LandDrawer({ land, onClose, embedded = false, onHistoryClick }: DrawerProps) {
  const queryClient = useQueryClient();
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showTitleDeedForm, setShowTitleDeedForm] = useState(false);
  const [showSalePriceForm, setShowSalePriceForm] = useState(false);
  const [titleDeedImage, setTitleDeedImage] = useState<File | null>(null);
  const [titleDeedDownloadError, setTitleDeedDownloadError] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState(land?.deposit_amount || '');
  const [salePrice, setSalePrice] = useState(land?.sale_price || '');
  const [installmentEnabled, setInstallmentEnabled] = useState(Boolean(land?.installment_plan.length));
  const [installmentCount, setInstallmentCount] = useState(String(land?.installment_plan.length || 12));
  const [firstInstallmentDate, setFirstInstallmentDate] = useState(
    land?.installment_plan[0]?.due_date || getDefaultInstallmentDate(),
  );
  const [installmentPlan, setInstallmentPlan] = useState<LandInstallment[]>(land?.installment_plan || []);
  const [notes, setNotes] = useState(land?.reservation_notes || '');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(
    () => splitPhoneNumber(land?.customer_phone || '').country,
  );
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneSubmitAttempted, setPhoneSubmitAttempted] = useState(false);
  const [reservation, setReservation] = useState<ReservationForm>(() => ({
    customer_name: land?.customer_name || '',
    customer_phone: splitPhoneNumber(land?.customer_phone || '').number,
  }));
  
  const mutation = useMutation({
    mutationFn: ({ id, update, image }: { id: number; update: LandUpdate; image?: File }) =>
      updateLandStatus(id, update, image),
    onSuccess: (updatedLand) => {
      queryClient.setQueryData<Land[]>(['lands'], old =>
        old?.map(item => item.id === updatedLand.id ? updatedLand : item)
      );
      setNotes(updatedLand.reservation_notes || '');
      setSalePrice(updatedLand.sale_price || '');
      setInstallmentPlan(updatedLand.installment_plan || []);
      setInstallmentEnabled(Boolean(updatedLand.installment_plan?.length));
      queryClient.invalidateQueries({ queryKey: ['lands'] });
      queryClient.invalidateQueries({ queryKey: ['landHistory', updatedLand.id] });
    }
  });

  const openReservationForm = () => {
    if (!land) return;
    setReservation({
      customer_name: land.customer_name,
      customer_phone: splitPhoneNumber(land.customer_phone).number,
    });
    setPhoneCountry(splitPhoneNumber(land.customer_phone).country);
    setPhoneTouched(false);
    setPhoneSubmitAttempted(false);
    setShowReservationForm(true);
  };

  if (!land) return null;

  const currentStageIndex = STAGES.indexOf(land.status);
  const isTitleDeedStage = land.status === 'TAPU';
  const isDepositStage = land.status === 'KAPORA_ALINDI';
  const isReservationFormRequired = land.status === 'BOS';
  const remainingPriceCents =
    Math.round(Number(salePrice) * 100) - Math.round(Number(land.deposit_amount || 0) * 100);
  const installmentPlanIsBalanced =
    installmentEnabled
    && installmentPlan.length > 0
    && installmentPlan.every(item => item.due_date && Number(item.amount) > 0)
    && sumInstallments(installmentPlan) === remainingPriceCents;
  const generateInstallments = () => {
    const generated = createInstallmentPlan(
      salePrice,
      land.deposit_amount,
      Number(installmentCount),
      firstInstallmentDate,
    );
    setInstallmentPlan(generated);
  };
  const renderInstallmentFields = () => (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={installmentEnabled}
          onChange={event => {
            setInstallmentEnabled(event.target.checked);
            if (!event.target.checked) setInstallmentPlan([]);
          }}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        Taksitli satış
      </label>
      {installmentEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              Vade sayısı (ay)
              <input
                type="number"
                required
                min="1"
                max="360"
                step="1"
                value={installmentCount}
                onChange={event => setInstallmentCount(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              İlk vade tarihi
              <input
                type="date"
                required
                value={firstInstallmentDate}
                onChange={event => setFirstInstallmentDate(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Peşinat/kapora: {formatCurrency(String(Number(land.deposit_amount || 0)))}
            {' · '}Taksitlere bölünecek: {remainingPriceCents > 0 ? formatCurrency(String(remainingPriceCents / 100)) : 'Satış bedeli ve peşinatı kontrol edin'}
          </p>
          <button
            type="button"
            onClick={generateInstallments}
            disabled={!salePrice || Number(salePrice) <= 0 || !installmentCount || Number(installmentCount) < 1 || Number(installmentCount) > 360 || remainingPriceCents <= 0 || !firstInstallmentDate}
            className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {installmentPlan.length ? 'Taksitleri yeniden hesapla' : 'Taksit planı oluştur'}
          </button>
          {installmentPlan.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {installmentPlan.map((installment, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr] items-center gap-2">
                  <label className="text-xs text-slate-500">
                    {index + 1}. vade
                    <input
                      type="date"
                      required
                      value={installment.due_date}
                      onChange={event => setInstallmentPlan(current => current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, due_date: event.target.value } : item,
                      ))}
                      className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Tutar (TL)
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={installment.amount}
                      onChange={event => setInstallmentPlan(current => current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, amount: event.target.value } : item,
                      ))}
                      className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                    />
                  </label>
                </div>
              ))}
              <p className={`text-xs font-medium ${installmentPlanIsBalanced ? 'text-emerald-700' : 'text-red-600'}`}>
                Taksit toplamı: {formatCurrency(String(sumInstallments(installmentPlan) / 100))}
                {installmentPlanIsBalanced
                  ? ' · Kalan satış bedeliyle eşleşiyor'
                  : ' · Taksitlerin toplamı peşinat sonrası kalan tutara eşit olmalı'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
  const saveReservation = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPhoneSubmitAttempted(true);
    if (getPhoneValidationError(reservation.customer_phone, phoneCountry)) return;
    const update: LandUpdate = {
      status: isReservationFormRequired ? 'REZERV' : land.status,
      ...reservation,
      customer_phone: formatInternationalPhone(reservation.customer_phone, phoneCountry),
    };
    mutation.mutate({ id: land.id, update }, {
      onSuccess: () => {
        setShowReservationForm(false);
        onClose();
      },
    });
  };
  const openDepositForm = () => {
    setDepositAmount(land.deposit_amount || '');
    setShowDepositForm(true);
  };
  const saveDeposit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate({
      id: land.id,
      update: { status: 'KAPORA_ALINDI', deposit_amount: depositAmount },
    }, {
      onSuccess: () => setShowDepositForm(false),
    });
  };
  const saveNotes = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate({ id: land.id, update: { status: land.status, reservation_notes: notes } });
  };
  const saveTitleDeed = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!titleDeedImage) return;
    if (installmentEnabled && !installmentPlanIsBalanced) return;
    mutation.mutate(
      {
        id: land.id,
        update: {
          status: 'TAPU',
          sale_price: salePrice,
          installment_plan: installmentEnabled ? installmentPlan : [],
        },
        image: titleDeedImage,
      },
      {
        onSuccess: () => {
          setShowTitleDeedForm(false);
          setTitleDeedImage(null);
          setShowSalePriceForm(false);
          onClose();
        },
      },
    );
  };
  const saveSalePrice = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (installmentEnabled && !installmentPlanIsBalanced) return;
    mutation.mutate(
      {
        id: land.id,
        update: {
          status: land.status,
          sale_price: salePrice,
          installment_plan: installmentEnabled ? installmentPlan : [],
        },
      },
      { onSuccess: () => setShowSalePriceForm(false) },
    );
  };
  const returnToPreviousStage = () => {
    if (currentStageIndex <= 0) return;
    const previousStage = STAGES[currentStageIndex - 1];
    if (previousStage === 'BOS') {
      mutation.reset();
      setShowCancelDialog(true);
      return;
    }
    if (previousStage === 'KAPORA_ALINDI' && !land.deposit_amount) {
      openDepositForm();
      return;
    }
    mutation.mutate(
      { id: land.id, update: getLandStatusUpdate(previousStage) },
      { onSuccess: onClose },
    );
  };
  const downloadTitleDeed = async () => {
    if (!land.title_deed_image) return;
    setTitleDeedDownloadError(null);
    try {
      const image = await downloadTitleDeedImage(land.title_deed_image);
      const downloadUrl = URL.createObjectURL(image);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = decodeURIComponent(new URL(land.title_deed_image).pathname.split('/').pop() || `tapu-${land.ada}-${land.parsel}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setTitleDeedDownloadError(error instanceof Error ? error.message : 'Tapu görseli indirilemedi.');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={embedded ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={embedded
          ? 'relative z-0 flex min-h-[calc(100dvh-12rem)] flex-1 justify-center'
          : 'fixed inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-sm'}
        onClick={embedded ? undefined : onClose}
      >
        <motion.div
          initial={embedded ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={embedded ? undefined : { x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={embedded
            ? 'flex min-h-[calc(100dvh-12rem)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm'
            : 'z-50 flex h-[100dvh] w-full max-w-md flex-col bg-white shadow-2xl'}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Ada {land.ada} / Parsel {land.parsel}</h2>
              <div className="flex items-center text-slate-500 text-sm mt-1">
                <MapPin size={14} className="mr-1" />
                {land.il}, {land.ilce}, {land.mahalle}
              </div>
              {isTitleDeedStage && (
                <span className="mt-2 inline-flex items-center rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-800">
                  Tapu Verildi
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {embedded && onHistoryClick && (
                <button
                  type="button"
                  onClick={onHistoryClick}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                >
                  <History size={16} />
                  <span className="hidden sm:inline">İşlem geçmişi</span>
                  <span className="sm:hidden">Geçmiş</span>
                </button>
              )}
              {!embedded && (
                <button
                  type="button"
                  aria-label="Kapat"
                  onClick={onClose}
                  className="rounded-full border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className={embedded ? 'lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-8' : ''}>
              {/* Sol: satış süreci ve işlemler */}
              <div className="min-w-0">
                {!isTitleDeedStage && <>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Satış Süreci</h3>
                <div className="relative mb-8">
                  <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-slate-200"></div>
                  <div className="space-y-6 relative">
                    {STAGES.map((stage, idx) => {
                      const isCompleted = idx <= currentStageIndex;
                      const isCurrent = idx === currentStageIndex;
                      const transition = [...(land.status_history || [])]
                        .reverse()
                        .find(item => item.status === stage);
                  
                      return (
                        <div key={stage} className="flex items-start">
                          <div className="relative z-10 bg-white pt-1">
                            {isCompleted ? (
                              <CheckCircle2 size={30} className="text-blue-600 bg-white" />
                            ) : (
                              <Circle size={30} className="text-slate-300 bg-white" />
                            )}
                          </div>
                          <div className="ml-4 mt-1.5 flex-1">
                            <div className={`font-medium ${isCompleted ? 'text-slate-800' : 'text-slate-400'}`}>
                              {statusLabels[stage]}
                            </div>
                            {transition && (
                              <div className="mt-1 text-xs text-slate-500">
                                Geçiş: {formatTransitionDate(transition.transitioned_at)}
                              </div>
                            )}
                            {isCurrent && idx > 0 && stage !== 'TAPU' && (
                              <button
                                type="button"
                                onClick={returnToPreviousStage}
                                disabled={mutation.isPending}
                                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                              >
                                <ArrowLeft size={16} />
                                Önceki aşamaya dön
                              </button>
                            )}
                            {isCurrent && idx < STAGES.length - 1 && !showTitleDeedForm && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (STAGES[idx + 1] === 'REZERV') {
                                    openReservationForm();
                                  } else if (STAGES[idx + 1] === 'KAPORA_ALINDI') {
                                    openDepositForm();
                                  } else {
                                    setTitleDeedImage(null);
                                    setSalePrice(land.sale_price || '');
                                    setInstallmentPlan(land.installment_plan || []);
                                    setInstallmentEnabled(Boolean(land.installment_plan?.length));
                                    setInstallmentCount(String(land.installment_plan?.length || 12));
                                    setFirstInstallmentDate(land.installment_plan?.[0]?.due_date || getDefaultInstallmentDate());
                                    setShowTitleDeedForm(true);
                                  }
                                }}
                                disabled={mutation.isPending}
                                className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                              >
                                {STAGES[idx + 1] === 'REZERV'
                                  ? 'Rezervasyon Bilgilerini Gir'
                                  : STAGES[idx + 1] === 'KAPORA_ALINDI'
                                    ? 'Kapora Tutarını Gir'
                                    : 'Satış Bedeli ve Tapu Bilgilerini Gir'}
                              </button>
                            )}
                            {isCurrent && STAGES[idx + 1] === 'TAPU' && showTitleDeedForm && (
                              <form onSubmit={saveTitleDeed} className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <label className="block text-sm font-medium text-slate-700">
                                  Satış bedeli (TL) <span className="text-red-600">(zorunlu)</span>
                                  <input
                                    type="number"
                                    required
                                    min="0.01"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={salePrice}
                                    onChange={event => setSalePrice(event.target.value)}
                                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
                                  />
                                </label>
                                {renderInstallmentFields()}
                                <label className="block text-sm font-medium text-slate-700">
                                  <span className="flex items-center gap-2">
                                    <ImagePlus size={16} className="text-blue-600" />
                                    Tapu görseli <span className="text-red-600">(zorunlu)</span>
                                  </span>
                                  <input
                                    type="file"
                                    required
                                    accept="image/jpeg,image/png,image/webp"
                                    capture="environment"
                                    onChange={event => setTitleDeedImage(event.target.files?.[0] ?? null)}
                                    className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                  />
                                </label>
                                <p className="text-xs text-slate-500">JPG, PNG veya WebP görseli seçin (en fazla 10 MB).</p>
                                {mutation.isError && (
                                  <p role="alert" className="text-sm text-red-600">
                                    Tapu aşamasına geçilemedi: {mutation.error.message}
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowTitleDeedForm(false)}
                                    disabled={mutation.isPending}
                                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                                  >
                                    Vazgeç
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={mutation.isPending || !titleDeedImage || !salePrice || Number(salePrice) <= 0 || (installmentEnabled && !installmentPlanIsBalanced)}
                                    className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {mutation.isPending ? 'Kaydediliyor...' : 'Bilgileri Kaydet ve Tapuya Geç'}
                                  </button>
                                </div>
                              </form>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </>}

                {isTitleDeedStage && (
                  <section className="mb-8">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Tapu görseli</h3>
                    {land.title_deed_image ? (
                      <button
                        type="button"
                        onClick={downloadTitleDeed}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Download size={18} />
                        Tapu görselini indir
                      </button>
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Tapu görseli yüklenmemiş.</p>
                    )}
                    {titleDeedDownloadError && (
                      <p role="alert" className="mt-2 text-sm text-red-600">
                        Tapu görseli indirilemedi: {titleDeedDownloadError}
                      </p>
                    )}
                  </section>
                )}

                {(isDepositStage || showDepositForm) && <section className="mb-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Kapora</h3>
                    {land.status === 'KAPORA_ALINDI' && !showDepositForm && (
                      <button
                        type="button"
                        onClick={openDepositForm}
                        className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        <Pencil size={14} /> Düzenle
                      </button>
                    )}
                  </div>
                  {showDepositForm ? (
                    <form onSubmit={saveDeposit} className="space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <label className="block text-sm font-medium text-slate-700">
                        Kapora tutarı (TL)
                        <input
                          type="number"
                          required
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          value={depositAmount}
                          onChange={event => setDepositAmount(event.target.value)}
                          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
                        />
                      </label>
                      {mutation.isError && (
                        <p role="alert" className="text-sm text-red-600">
                          Kapora tutarı kaydedilemedi: {mutation.error.message}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDepositForm(false)}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="submit"
                          disabled={mutation.isPending}
                          className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {mutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </div>
                    </form>
                  ) : land.status === 'KAPORA_ALINDI' && land.deposit_amount ? (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-2xl font-semibold text-slate-800">{formatCurrency(land.deposit_amount)}</p>
                    </div>
                  ) : land.deposit_amount ? (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-2xl font-semibold text-slate-800">{formatCurrency(land.deposit_amount)}</p>
                    </div>
                  ) : (
                    <p role="alert" className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                      Kapora tutarı girilmemiş. Düzenle düğmesinden kapora tutarını ekleyin.
                    </p>
                  )}
                </section>}

                {!isTitleDeedStage && land.status !== 'BOS' && (
                  <div className="mb-8">
                    <button
                      type="button"
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.reset();
                        setShowCancelDialog(true);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                    >
                      <RotateCcw size={16} />
                      Arsayı Boşa Al
                    </button>
                    <p className="mt-2 text-center text-xs text-slate-500">
                      İptal nedeni sorulur; müşteri kartı ve geçmişi silinmez.
                    </p>
                  </div>
                )}

                {!isTitleDeedStage && <div className="mt-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Rezervasyon Bilgileri</h3>
                    {land.status === 'REZERV' && !showReservationForm && (
                      <button
                        type="button"
                        onClick={openReservationForm}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Pencil size={14} /> Düzenle
                      </button>
                    )}
                  </div>
                  {showReservationForm ? (
                    <form onSubmit={saveReservation} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <label className="block text-sm font-medium text-slate-700">
                        Müşteri adı soyadı
                        <input
                          type="text"
                          required
                          maxLength={200}
                          value={reservation.customer_name}
                          onChange={event => setReservation(current => ({ ...current, customer_name: event.target.value }))}
                          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        Telefon
                        <PhoneNumberInput
                          value={reservation.customer_phone}
                          country={phoneCountry}
                          onChange={value => setReservation(current => ({ ...current, customer_phone: value }))}
                          onCountryChange={setPhoneCountry}
                          onBlur={() => setPhoneTouched(true)}
                          error={(phoneTouched || phoneSubmitAttempted)
                            ? getPhoneValidationError(reservation.customer_phone, phoneCountry)
                            : null}
                        />
                      </label>
                      {mutation.isError && (
                        <p role="alert" className="text-sm text-red-600">{mutation.error.message}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowReservationForm(false)}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="submit"
                          disabled={mutation.isPending}
                          className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {mutation.isPending ? 'Kaydediliyor...' : 'Rezervasyonu Kaydet'}
                        </button>
                      </div>
                    </form>
                  ) : land.status === 'REZERV' || isDepositStage ? (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                      <div className="flex items-start gap-3 text-sm text-slate-700">
                        <UserRound size={16} className="mt-0.5 text-slate-400" />
                        <div>
                          <p className="font-medium">{land.customer_name || 'Müşteri belirtilmedi'}</p>
                          {land.customer_phone && <p className="text-slate-500">{land.customer_phone}</p>}
                          {land.customer && (
                            <Link
                              to={`/customers/${land.customer}`}
                              className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                            >
                              Müşteri kartını aç →
                            </Link>
                          )}
                          {isDepositStage && land.deposit_amount && (
                            <p className="mt-2 border-t border-slate-200 pt-2 text-sm">
                              <span className="text-slate-500">Kapora: </span>
                              <span className="font-semibold text-slate-800">{formatCurrency(land.deposit_amount)}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm italic text-slate-400">
                      Arsa rezerve edildiğinde müşteri bilgilerini buradan girebilirsiniz.
                    </p>
                  )}

                </div>}
              </div>

              {/* Sağ: satış bedeli, müşteri/arsa bilgileri ve notlar */}
              <div className={embedded ? 'mt-8 min-w-0 lg:mt-0' : 'mt-8 min-w-0'}>
                <section className="mb-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600">Satış bedeli</h3>
                    {land.status === 'TAPU' && !showSalePriceForm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSalePrice(land.sale_price || '');
                          setInstallmentPlan(land.installment_plan || []);
                          setInstallmentEnabled(Boolean(land.installment_plan?.length));
                          setInstallmentCount(String(land.installment_plan?.length || 12));
                          setFirstInstallmentDate(land.installment_plan?.[0]?.due_date || getDefaultInstallmentDate());
                          setShowSalePriceForm(true);
                        }}
                        className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        <Pencil size={14} /> Düzenle
                      </button>
                    )}
                  </div>
                  {showSalePriceForm ? (
                    <form onSubmit={saveSalePrice} className="space-y-3">
                      <label className="block text-sm font-medium text-slate-700">
                        Satış bedeli (TL)
                        <input
                          type="number"
                          required
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          value={salePrice}
                          onChange={event => setSalePrice(event.target.value)}
                          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
                        />
                      </label>
                      {renderInstallmentFields()}
                      {mutation.isError && <p role="alert" className="text-sm text-red-600">Satış bedeli kaydedilemedi: {mutation.error.message}</p>}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setShowSalePriceForm(false)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white">
                          Vazgeç
                        </button>
                        <button type="submit" disabled={mutation.isPending || (installmentEnabled && !installmentPlanIsBalanced)} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                          {mutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </div>
                    </form>
                  ) : land.sale_price ? (
                    <>
                      <p className="text-2xl font-bold text-slate-900">{formatCurrency(land.sale_price)}</p>
                      {land.deposit_amount && (
                        <div className="mt-3 border-t border-blue-100 pt-3 text-sm">
                          <span className="block text-xs text-slate-500">Alınan kapora</span>
                          <span className="font-semibold text-slate-800">{formatCurrency(land.deposit_amount)}</span>
                        </div>
                      )}
                      {land.installment_plan?.length > 0 && (
                        <div className="mt-3 space-y-1 border-t border-blue-100 pt-3 text-sm">
                          <p className="mb-2 text-xs font-semibold text-slate-500">Taksit planı · {land.installment_plan.length} vade</p>
                          {land.installment_plan.map((item, index) => (
                            <div key={`${item.due_date}-${index}`} className="flex justify-between gap-3 text-slate-700">
                              <span>{index + 1}. taksit · {new Date(`${item.due_date}T00:00:00`).toLocaleDateString('tr-TR')}</span>
                              <span className="font-medium">{formatCurrency(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {land.status === 'TAPU' ? 'Satış bedeli henüz girilmemiş.' : 'Tapu aşamasına geçerken satış bedeli girilecek.'}
                    </p>
                  )}
                </section>

                {isTitleDeedStage && (
                  <>
                    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Müşteri bilgileri</h3>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <dt className="text-slate-500">Adı soyadı</dt>
                        <dd className="text-right font-medium text-slate-800">{land.customer_name || 'Belirtilmedi'}</dd>
                        <dt className="text-slate-500">Telefon</dt>
                        <dd className="text-right font-medium text-slate-800">{land.customer_phone || 'Belirtilmedi'}</dd>
                      </dl>
                      {land.customer && (
                        <Link
                          to={`/customers/${land.customer}`}
                          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Müşteri kartını aç →
                        </Link>
                      )}
                    </section>
                    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Arsa bilgileri</h3>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <dt className="text-slate-500">İl</dt><dd className="text-right font-medium text-slate-800">{land.il}</dd>
                        <dt className="text-slate-500">İlçe</dt><dd className="text-right font-medium text-slate-800">{land.ilce}</dd>
                        <dt className="text-slate-500">Mahalle</dt><dd className="text-right font-medium text-slate-800">{land.mahalle}</dd>
                        <dt className="text-slate-500">Ada</dt><dd className="text-right font-medium text-slate-800">{land.ada}</dd>
                        <dt className="text-slate-500">Parsel</dt><dd className="text-right font-medium text-slate-800">{land.parsel}</dd>
                      </dl>
                    </section>
                  </>
                )}

                {!isTitleDeedStage && (
                  <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Arsa bilgileri</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <dt className="text-slate-500">İl</dt><dd className="text-right font-medium text-slate-800">{land.il}</dd>
                      <dt className="text-slate-500">İlçe</dt><dd className="text-right font-medium text-slate-800">{land.ilce}</dd>
                      <dt className="text-slate-500">Mahalle</dt><dd className="text-right font-medium text-slate-800">{land.mahalle}</dd>
                      <dt className="text-slate-500">Ada / Parsel</dt><dd className="text-right font-medium text-slate-800">{land.ada} / {land.parsel}</dd>
                    </dl>
                  </section>
                )}

                <LandLocationCard land={land} canEdit />


                <section className="mb-8">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Notlar</h3>
                  <form onSubmit={saveNotes} className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <label htmlFor="land-notes" className="block text-sm font-medium text-slate-700">Arsa notu</label>
                    <textarea
                      id="land-notes"
                      rows={5}
                      maxLength={10000}
                      value={notes}
                      onChange={event => setNotes(event.target.value)}
                      placeholder="Arsayla ilgili notları yazın..."
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    {mutation.isError && <p role="alert" className="text-sm text-red-600">Not kaydedilemedi: {mutation.error.message}</p>}
                    <button
                      type="submit"
                      disabled={mutation.isPending || notes === (land.reservation_notes || '')}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {mutation.isPending ? 'Kaydediliyor...' : 'Notu kaydet'}
                    </button>
                  </form>
                </section>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
      {showCancelDialog && (
        <CancelLandDialog
          land={land}
          isPending={mutation.isPending}
          error={mutation.error}
          onClose={() => setShowCancelDialog(false)}
          onConfirm={(reason, detail, note) =>
            mutation.mutate(
              {
                id: land.id,
                update: { ...getLandStatusUpdate('BOS'), cancel_reason: reason, cancel_detail: detail, cancel_note: note },
              },
              {
                onSuccess: () => {
                  setShowCancelDialog(false);
                  onClose();
                },
              },
            )
          }
        />
      )}
    </AnimatePresence>
  );
}
