import { TrendingDown } from 'lucide-react';
import type { InstallmentLoss } from '../types';

const formatTry = (value: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(value));

const formatPercent = (value: number) => `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;

const formatRate = (loss: InstallmentLoss) => `aylık %${Number(loss.monthly_interest_rate).toLocaleString('tr-TR')}`;

/** Arsa listesinde: taksit zararının TL ve yüzde özeti (yalnızca yönetici, taksitli satışta). */
export function InstallmentLossBadge({ loss }: { loss?: InstallmentLoss | null }) {
  if (!loss) return <span className="text-slate-300">—</span>;
  return (
    <span
      className="inline-flex flex-col whitespace-nowrap leading-tight"
      title={`${formatRate(loss)} faizle bugünkü değer: ${formatTry(loss.present_value)}`}
    >
      <span className="font-semibold text-rose-700">−{formatTry(loss.loss_amount)}</span>
      {loss.loss_percent != null && <span className="text-xs text-rose-500">{formatPercent(loss.loss_percent)}</span>}
    </span>
  );
}

/** Arsa detayında: paranın bugünkü değerine göre taksit zararı. */
export function InstallmentLossPanel({ loss, salePrice }: { loss?: InstallmentLoss | null; salePrice: string | null }) {
  if (!loss) return null;
  return (
    <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
          <TrendingDown size={14} />
          Taksit zararı ({formatRate(loss)} faiz)
        </span>
        {loss.loss_percent != null && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">{formatPercent(loss.loss_percent)}</span>
        )}
      </div>
      <p className="text-xl font-bold text-rose-700">−{formatTry(loss.loss_amount)}</p>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        {salePrice && (
          <div className="flex justify-between gap-3"><dt>Satış bedeli</dt><dd className="font-medium">{formatTry(salePrice)}</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt>Paranın bugünkü değeri</dt><dd className="font-medium">{formatTry(loss.present_value)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt>Hesap başlangıcı (satış günü)</dt>
          <dd className="font-medium">{new Date(`${loss.reference_date}T00:00:00`).toLocaleDateString('tr-TR')}</dd>
        </div>
      </dl>
    </div>
  );
}
