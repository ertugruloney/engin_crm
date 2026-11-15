export type LandStatus = 'BOS' | 'REZERV' | 'KAPORA_ALINDI' | 'TAPU';

// Müstakil: parselin tamamı tek satış. Hisseli: parsel paylara bölünür, her pay ayrı arsa kaydıdır.
export type OwnershipType = 'MUSTAKIL' | 'HISSELI';

export const ownershipLabels: Record<OwnershipType, string> = {
  MUSTAKIL: 'Müstakil',
  HISSELI: 'Hisseli',
};

export interface LandStatusHistory {
  id: number;
  status: LandStatus;
  transitioned_at: string;
}

export interface LandInstallment {
  due_date: string;
  amount: string;
}

export interface Land {
  id: number;
  il: string;
  ilce: string;
  mahalle: string;
  ada: string;
  parsel: string;
  ownership_type?: OwnershipType;
  // Hisseli arsada Excel'den gelen hisse numarası (ör. "3" ya da "3/10"); müstakil arsada boş.
  hisse_no?: string;
  status: LandStatus;
  is_reserved: boolean;
  reservation_notes: string;
  reservation_date: string | null;
  // Bağlı müşteri kartı (yalnızca yönetici ve satış destek görür).
  customer?: number | null;
  customer_name: string;
  customer_phone: string;
  deposit_amount: string | null;
  sale_price: string | null;
  // Taksitli satışta kaporaya ek peşin ödeme; taksitler satış bedeli - kapora - peşinat üzerinden bölünür.
  down_payment?: string | null;
  installment_plan: LandInstallment[];
  title_deed_image: string | null;
  // Kimlik fotoğraflarının yetkili indirme adresi (yalnızca yönetici/satış destek); yoksa null.
  id_front_image?: string | null;
  id_back_image?: string | null;
  // Konum (isteğe bağlı): ondalık derece ve Tapu Kadastro Parsel Sorgu linki.
  latitude?: string | null;
  longitude?: string | null;
  city_center_distance_km?: number | null;
  district_center_distance_km?: number | null;
  neighborhood_center_distance_km?: number | null;
  parcel_query_url?: string;
  // Kendi linki yoksa aynı mahalleden öğrenilen kalıpla üretilmiş link (salt okunur).
  parcel_query_url_auto?: string;
  // TKGM Parsel Sorgu'dan alınan bilgiler ("TKGM'den bilgileri getir").
  tkgm_mahalle_id?: number | null;
  parcel_area?: string | null;
  parcel_quality?: string;
  parcel_locality?: string;
  parcel_sheet?: string;
  parcel_geometry?: [number, number][] | null;
  tkgm_synced_at?: string | null;
  status_history: LandStatusHistory[];
}

export const statusLabels: Record<LandStatus, string> = {
  BOS: 'Satışa Uygun',
  REZERV: 'Rezerv',
  KAPORA_ALINDI: 'Kapora Alındı',
  TAPU: 'Tapu',
};

export const statusColors: Record<LandStatus, string> = {
  BOS: 'bg-green-100 text-green-800 border-green-300',
  REZERV: 'bg-amber-100 text-amber-700 border-amber-200',
  KAPORA_ALINDI: 'bg-blue-100 text-blue-700 border-blue-200',
  TAPU: 'bg-gray-100 text-gray-800 border-gray-300',
};

type ParcelIdentity = { ada: string; parsel: string; hisse_no?: string | null };

/** "Ada 45 / Parsel 7" ya da hisseli ise "Ada 45 / Parsel 7 · Hisse 3". */
export const parcelLabel = (land: ParcelIdentity) =>
  `Ada ${land.ada} / Parsel ${land.parsel}${land.hisse_no ? ` · Hisse ${land.hisse_no}` : ''}`;
