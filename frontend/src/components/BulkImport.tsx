import axios from 'axios';
import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as xlsx from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { bulkCreateLands, getLands } from '../api';
import { statusLabels } from '../types';
import type { Land, LandStatus } from '../types';
import { useNavigate } from 'react-router-dom';

type NewLand = Omit<Land, 'id' | 'title_deed_image'>;

const normalizeColumnName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]/g, '');

const normalizeLandPart = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i');

const normalizeSalePrice = (value: unknown): string | null => {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const raw = String(value).trim().replace(/[^\d,.-]/g, '');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  return normalized && Number.isFinite(Number(normalized)) ? normalized : null;
};

const getLandKey = (land: Pick<Land, 'il' | 'ilce' | 'mahalle' | 'ada' | 'parsel'>) =>
  [land.il, land.ilce, land.mahalle, land.ada, land.parsel].map(normalizeLandPart).join('|');

const formatSalePrice = (value: string | null) =>
  value
    ? new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value))
    : '—';

const getImportErrorMessage = (error: unknown) => {
  if (axios.isAxiosError<{ detail?: string; duplicate_rows?: number[] }>(error)) {
    const detail = error.response?.data?.detail ?? error.message;
    const rows = error.response?.data?.duplicate_rows;
    return rows?.length ? `${detail} Satır numaraları: ${rows.join(', ')}.` : detail;
  }
  return error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
};

const normalizeLandStatus = (value: unknown): LandStatus | null => {
  const status = String(value ?? '').trim();
  if (!status) return 'BOS';

  const normalized = normalizeColumnName(status);
  const statuses: Record<string, LandStatus> = {
    bos: 'BOS',
    satisa: 'BOS',
    satisauygun: 'BOS',
    rezerv: 'REZERV',
    rezerve: 'REZERV',
    kaporaalindi: 'KAPORA_ALINDI',
    tapu: 'TAPU',
  };
  return statuses[normalized] ?? null;
};

const getCell = (row: Record<string, unknown>, ...columnNames: string[]) => {
  const normalizedRow = new Map(
    Object.entries(row).map(([key, value]) => [normalizeColumnName(key), value]),
  );
  for (const columnName of columnNames) {
    const value = normalizedRow.get(normalizeColumnName(columnName));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

// İsteğe bağlı konum sütunları: Enlem, Boylam (virgüllü ondalık da olur) ve Parsel Sorgu Linki.
const parseLocationCells = (row: Record<string, unknown>) => {
  const toCoordinate = (value: unknown) => {
    const number = Number(String(value ?? '').trim().replace(',', '.'));
    return String(value ?? '').trim() && Number.isFinite(number) ? number.toFixed(6) : null;
  };
  const latitude = toCoordinate(getCell(row, 'Enlem', 'Latitude'));
  const longitude = toCoordinate(getCell(row, 'Boylam', 'Longitude'));
  return {
    latitude: latitude && longitude ? latitude : null,
    longitude: latitude && longitude ? longitude : null,
    parcel_query_url: String(getCell(row, 'Parsel Sorgu Linki', 'Parsel Sorgu', 'Parcel Query URL') ?? '').trim(),
  };
};

export default function BulkImport({
  returnPath = '/board',
  isSalesSupport = false,
}: {
  returnPath?: string;
  isSalesSupport?: boolean;
}) {
  const [data, setData] = useState<NewLand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const landsQuery = useQuery({ queryKey: ['lands'], queryFn: getLands });

  const mutation = useMutation({
    mutationFn: bulkCreateLands,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lands'] });
      navigate(returnPath);
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDuplicateNotice(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = xlsx.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const columnNames = Object.keys(rawData[0] ?? {}).map(normalizeColumnName);
        const hasColumn = (...names: string[]) =>
          names.some(name => columnNames.includes(normalizeColumnName(name)));
        const hasRequiredColumns =
          hasColumn('İl') &&
          hasColumn('İlçe') &&
          hasColumn('Mahalle') &&
          hasColumn('Ada No', 'Ada') &&
          hasColumn('Parsel No', 'Parsel') &&
          hasColumn('Durum', 'Status');

        if (!hasRequiredColumns) {
          setData([]);
          setError('Excel sütunları bulunamadı. Şablondaki başlıkları kullanın: İl, İlçe, Mahalle, Ada No, Parsel No, Durum.');
          return;
        }

        const invalidStatuses: string[] = [];
        const invalidSalePrices: string[] = [];
        const parsedData: NewLand[] = rawData.map((row, index) => {
          const rawStatus = getCell(row, 'Durum', 'Status');
          const status = normalizeLandStatus(rawStatus);
          if (!status) invalidStatuses.push(`${index + 2}. satır: ${String(rawStatus)}`);
          const salePrice = normalizeSalePrice(getCell(row, 'Satış Bedeli', 'Sale Price'));
          if (status === 'TAPU' && (!salePrice || Number(salePrice) <= 0)) {
            invalidSalePrices.push(`${index + 2}. satır`);
          }

          return {
            il: String(getCell(row, 'İl')),
            ilce: String(getCell(row, 'İlçe')),
            mahalle: String(getCell(row, 'Mahalle')),
            ada: String(getCell(row, 'Ada No', 'Ada')),
            parsel: String(getCell(row, 'Parsel No', 'Parsel')),
            status: status ?? 'BOS',
            is_reserved: false,
            reservation_notes: String(getCell(row, 'Not', 'Notes')),
            ...parseLocationCells(row),
            reservation_date: null,
            customer_name: '',
            customer_phone: '',
            deposit_amount: null,
            sale_price: salePrice,
            installment_plan: [],
            status_history: [],
          };
        }).filter(land => land.il && land.ilce && land.mahalle && land.ada && land.parsel);

        if (parsedData.length === 0) {
          setData([]);
          setError('Excel dosyasında aktarılabilir arsa kaydı bulunamadı. İl, İlçe, Mahalle, Ada No ve Parsel No alanlarını kontrol edin.');
        } else if (invalidStatuses.length > 0) {
          setData([]);
          setError(`Durum bilgisi tanınmayan satırlar var: ${invalidStatuses.join(', ')}. Durum için Satışa Uygun, Rezerv, Kapora Alındı veya Tapu kullanın.`);
        } else if (invalidSalePrices.length > 0) {
          setData([]);
          setError(`Tapu durumundaki arsalar için sıfırdan büyük Satış Bedeli girilmelidir: ${invalidSalePrices.join(', ')}.`);
        } else {
          const existingKeys = new Set((landsQuery.data ?? []).map(getLandKey));
          const seenKeys = new Set<string>();
          let existingDuplicates = 0;
          let fileDuplicates = 0;
          const uniqueRows = parsedData.filter(land => {
            const key = getLandKey(land);
            if (existingKeys.has(key)) {
              existingDuplicates += 1;
              return false;
            }
            if (seenKeys.has(key)) {
              fileDuplicates += 1;
              return false;
            }
            seenKeys.add(key);
            return true;
          });
          setData(uniqueRows);
          if (existingDuplicates || fileDuplicates) {
            setDuplicateNotice(
              `${existingDuplicates} satır sistemde zaten bulunduğu, ${fileDuplicates} satır Excel içinde tekrarlandığı için atlandı.`,
            );
          }
          if (uniqueRows.length === 0) {
            setError('Aktarılacak yeni arsa kaydı bulunamadı; tüm satırlar mevcut veya yinelenen kayıt.');
          }
        }
      } catch (err) {
        setError("Dosya okunurken bir hata oluştu. Lütfen geçerli bir Excel dosyası (.xlsx) yükleyin.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSave = () => {
    if (data.length > 0) {
      mutation.mutate(data);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto">
      <div className={`mb-8 rounded-2xl border p-5 ${
        isSalesSupport
          ? 'border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-blue-50'
          : 'border-transparent'
      }`}>
        {isSalesSupport && (
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white/80 px-2.5 py-1 text-xs font-semibold text-indigo-700">
            TOPLU İŞLEM
          </span>
        )}
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
          {isSalesSupport ? 'Arsa Aktarım Merkezi' : 'Toplu Arsa Ekle (Excel)'}
        </h1>
        <p className="mt-1 text-slate-500">
          {isSalesSupport
            ? 'Excel dosyanızı yükleyin, kayıtları önizleyin ve arsaları sisteme aktarın.'
            : 'Excel dosyasından toplu olarak arsa kayıtlarını sisteme aktarın.'}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-8">
        <div
          className="border-2 border-dashed border-blue-200 rounded-xl bg-gradient-to-b from-blue-50/50 to-white p-10 text-center hover:border-blue-400 hover:bg-blue-50/70 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls"
            disabled={landsQuery.isLoading || landsQuery.isError}
            className="hidden"
          />
          <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
            <Upload size={30} />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-1">Excel Dosyası Yükle</h3>
          <p className="text-slate-500 text-sm mb-4">
            {landsQuery.isLoading ? 'Mevcut arsalar kontrol ediliyor...' : '.xlsx veya .xls formatındaki dosyalarınızı seçin veya sürükleyin.'}
          </p>
          <button className="px-4 py-2 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-700 transition-colors">
            Dosya Seç
          </button>
        </div>

        <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-100 flex items-start text-sm text-slate-600">
          <AlertCircle size={20} className="text-amber-500 mr-3 shrink-0 mt-0.5" />
          <div>
            <strong>Excel sütunları:</strong> İl, İlçe, Mahalle, Ada No, Parsel No ve Durum.
            Başlıklar büyük/küçük harfe duyarsızdır. Durum değerleri: Satışa Uygun, Rezerv, Kapora Alındı veya Tapu. Tapu durumu için Satış Bedeli sütunu zorunludur. Not, Enlem, Boylam ve Parsel Sorgu Linki sütunları isteğe bağlıdır.
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100 mb-6 flex items-center">
          <AlertCircle size={20} className="mr-2" />
          {error}
        </div>
      )}
      {landsQuery.isError && (
        <div role="alert" className="mb-6 flex items-center rounded-lg border border-red-100 bg-red-50 p-4 text-red-600">
          <AlertCircle size={20} className="mr-2 shrink-0" />
          Mevcut arsalar kontrol edilemedi: {landsQuery.error.message}
        </div>
      )}
      {duplicateNotice && (
        <div role="status" className="mb-6 flex items-center rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertCircle size={20} className="mr-2 shrink-0" />
          {duplicateNotice}
        </div>
      )}
      {mutation.isError && (
        <div role="alert" className="mb-6 flex items-center rounded-lg border border-red-100 bg-red-50 p-4 text-red-600">
          <AlertCircle size={20} className="mr-2 shrink-0" />
          Aktarım başarısız: {getImportErrorMessage(mutation.error)}
        </div>
      )}

      {data.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="font-semibold text-slate-700 flex items-center">
              <FileSpreadsheet size={18} className="text-green-600 mr-2" />
              Önizleme <span className="ml-2 text-slate-400 text-sm font-normal">({data.length} kayıt bulundu)</span>
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setData([])}
                className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium flex items-center transition-colors"
              >
                <Trash2 size={16} className="mr-1.5" /> Temizle
              </button>
              <button
                onClick={handleSave}
                disabled={mutation.isPending}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium flex items-center shadow-sm transition-colors"
              >
                {mutation.isPending ? 'Kaydediliyor...' : <><CheckCircle2 size={16} className="mr-1.5" /> Sisteme Aktar</>}
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1 p-0">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-white sticky top-0 z-10 shadow-sm shadow-slate-100">
                <tr>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">İl</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">İlçe</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">Mahalle</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">Ada</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">Parsel</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">Durum</th>
                  <th className="py-3 px-6 text-slate-500 font-semibold border-b border-slate-200">Satış Bedeli</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-300">
                {data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-2.5 px-6 text-slate-700">{row.il}</td>
                    <td className="py-2.5 px-6 text-slate-700">{row.ilce}</td>
                    <td className="py-2.5 px-6 text-slate-700">{row.mahalle}</td>
                    <td className="py-2.5 px-6 font-medium text-slate-800">{row.ada}</td>
                    <td className="py-2.5 px-6 font-medium text-slate-800">{row.parsel}</td>
                    <td className="py-2.5 px-6 text-slate-700">{statusLabels[row.status]}</td>
                    <td className="py-2.5 px-6 text-slate-700">{formatSalePrice(row.sale_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
