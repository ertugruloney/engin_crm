import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, SlidersHorizontal } from 'lucide-react';
import {
  DEFAULT_FILTER_VISIBILITY,
  FILTER_FIELDS,
  loadFilterVisibility,
  saveFilterVisibility,
} from '../filterSettings';
import type { FilterField, FilterVisibility } from '../filterSettings';
import { getNotificationSettings, updateNotificationSettings } from '../api';

const FILTER_LABELS: Record<FilterField, string> = {
  il: 'İl',
  ilce: 'İlçe',
  mahalle: 'Mahalle',
  ada: 'Ada',
  parsel: 'Parsel',
};

function NotificationSettingsSection() {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const settingsQuery = useQuery({
    queryKey: ['notificationSettings'],
    queryFn: getNotificationSettings,
  });
  const saveMutation = useMutation({
    mutationFn: (disabledCodes: string[]) => updateNotificationSettings(disabledCodes),
    onSuccess: async () => {
      setOverrides({});
      await queryClient.invalidateQueries({ queryKey: ['notificationSettings'] });
    },
  });

  const entries = settingsQuery.data?.settings ?? [];
  const isEnabled = (code: string, fallback: boolean) => overrides[code] ?? fallback;
  const currentDisabled = entries
    .filter(entry => !isEnabled(entry.code, entry.enabled))
    .map(entry => entry.code)
    .sort();
  const savedDisabled = entries
    .filter(entry => !entry.enabled)
    .map(entry => entry.code)
    .sort();
  const isDirty = JSON.stringify(currentDisabled) !== JSON.stringify(savedDisabled);

  const setAll = (enabled: boolean) => {
    setOverrides(Object.fromEntries(entries.map(entry => [entry.code, enabled])));
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
        <Bell size={18} />
        Bildirim ayarları
      </h2>
      <p className="mb-5 text-sm text-slate-500">
        Zil simgesinde görünecek bildirim türlerini açın veya kapatın. Her satırın sonundaki kod,
        sunucuda tetiklenen bildirim kodudur.
      </p>

      {settingsQuery.isLoading && <p className="text-sm text-slate-500">Bildirim ayarları yükleniyor...</p>}
      {settingsQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Bildirim ayarları yüklenemedi: {settingsQuery.error.message}
        </p>
      )}

      {settingsQuery.data && (
        <>
          <div className="space-y-3">
            {entries.map(entry => (
              <label
                key={entry.code}
                className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3"
              >
                <span>
                  <span className="font-medium text-slate-700">{entry.label}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">{entry.description}</span>
                  <code className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                    {entry.code}
                  </code>
                </span>
                <input
                  type="checkbox"
                  checked={isEnabled(entry.code, entry.enabled)}
                  onChange={event => {
                    setOverrides(current => ({ ...current, [entry.code]: event.target.checked }));
                    saveMutation.reset();
                  }}
                  className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                />
              </label>
            ))}
          </div>

          {saveMutation.isError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              Bildirim ayarları kaydedilemedi: {saveMutation.error.message}
            </p>
          )}
          {saveMutation.isSuccess && (
            <p role="status" className="mt-4 text-sm text-green-700">Bildirim ayarları kaydedildi.</p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Tümünü aç
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Tümünü kapat
            </button>
            <button
              type="button"
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate(currentDisabled)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Check size={16} />
              {saveMutation.isPending ? 'Kaydediliyor...' : 'Bildirim ayarlarını kaydet'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const [visibility, setVisibility] = useState<FilterVisibility>(loadFilterVisibility);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      saveFilterVisibility(visibility);
      setSaved(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Filtre ayarları kaydedilemedi.');
      setSaved(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-800">Ayarlar</h1>
        <p className="mt-1 text-slate-500">Satış panosu filtrelerini ve yönetici bildirimlerini yapılandırın.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
          <SlidersHorizontal size={18} />
          Satış panosu filtreleri
        </h2>
        <p className="mb-5 text-sm text-slate-500">
          Seçili alanlar satış panosundaki filtre bölümünde görünür. Bu ayar tarayıcınızda saklanır.
        </p>

        <div className="space-y-3">
          {FILTER_FIELDS.map(field => (
            <label key={field} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="font-medium text-slate-700">{FILTER_LABELS[field]}</span>
              <input
                type="checkbox"
                checked={visibility[field]}
                onChange={event => {
                  setVisibility(current => ({ ...current, [field]: event.target.checked }));
                  setSaved(false);
                }}
                className="h-4 w-4 accent-blue-600"
              />
            </label>
          ))}
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {saved && <p role="status" className="mt-4 text-sm text-green-700">Filtre ayarları kaydedildi.</p>}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setVisibility(DEFAULT_FILTER_VISIBILITY);
              setSaved(false);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Varsayılana dön
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Check size={16} />
            Ayarları kaydet
          </button>
        </div>
      </section>

      <NotificationSettingsSection />
    </div>
  );
}
