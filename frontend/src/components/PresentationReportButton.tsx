import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { ChevronDown, FileText, Loader2, Presentation } from 'lucide-react';
import { downloadPresentationReport } from '../api';
import type { PresentationReportType } from '../api';

const OPTIONS: { type: PresentationReportType; label: string; hint: string; icon: typeof FileText }[] = [
  { type: 'pptx', label: 'PowerPoint (.pptx)', hint: 'Düzenlenebilir sunum, grafikler dahil', icon: Presentation },
  { type: 'pdf', label: 'PDF', hint: 'Paylaşmaya ve yazdırmaya hazır', icon: FileText },
];

const errorText = async (error: unknown) => {
  if (isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const data = JSON.parse(await error.response.data.text()) as { detail?: string };
      if (data.detail) return data.detail;
    } catch {
      // Sunucu JSON dışında bir hata döndürdüyse genel mesaj gösterilir.
    }
  }
  return error instanceof Error ? error.message : 'Rapor oluşturulamadı.';
};

/**
 * Yönetici ana ekranında seçili dönemin satış özetini PowerPoint ya da PDF olarak indirir.
 * İçerik: genel bakış, bölgeler, iller, müstakil/hisseli, hisseli parseller, temsilciler, iptal nedenleri.
 */
export default function PresentationReportButton({
  dateFrom,
  dateTo,
  periodLabel,
}: {
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PresentationReportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const download = async (type: PresentationReportType) => {
    setPending(type);
    setError(null);
    try {
      const { blob, fileName } = await downloadPresentationReport(type, { dateFrom, dateTo, periodLabel });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (downloadError) {
      setError(await errorText(downloadError));
    } finally {
      setPending(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="inline-flex items-center gap-2 rounded-full bg-[#13254f] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1d3570]"
      >
        <Presentation size={16} />
        Sunum raporu
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200"
        >
          <p className="px-3 pb-2 pt-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{periodLabel}</span> dönemi için satış özeti
          </p>
          {OPTIONS.map(({ type, label, hint, icon: Icon }) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              disabled={pending !== null}
              onClick={() => download(type)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                {pending === type ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">{pending === type ? 'Hazırlanıyor...' : label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </button>
          ))}
          {error && <p role="alert" className="px-3 pb-1 pt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
