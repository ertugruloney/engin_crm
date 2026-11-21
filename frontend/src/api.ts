import axios from 'axios';
import type { Land, LandStatus } from './types';

export type UserRole = 'admin' | 'sales_representative' | 'sales_support' | 'call_center';

export interface AppUser {
  id: number;
  username: string;
  role: UserRole;
}

const api = axios.create({
  baseURL: '/api/',
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
});

export const getCurrentUser = async (): Promise<AppUser> => {
  const { data } = await api.get('auth/me/');
  return data;
};

export const login = async (username: string, password: string): Promise<AppUser> => {
  await api.get('auth/csrf/');
  const { data } = await api.post('auth/login/', { username, password });
  return data;
};

export const logout = async (): Promise<void> => {
  await api.post('auth/logout/');
};

export interface ViewerUser {
  id: number;
  username: string;
  role: Exclude<UserRole, 'admin'>;
}

export type RepresentativeLand = Pick<
  Land,
  | 'id'
  | 'il'
  | 'ilce'
  | 'mahalle'
  | 'ada'
  | 'parsel'
  | 'status'
> & { can_take_deposit?: boolean } & Partial<Pick<
  Land,
  | 'ownership_type'
  | 'hisse_no'
  | 'reservation_date'
  | 'customer_name'
  | 'customer_phone'
  | 'reservation_notes'
  | 'latitude'
  | 'longitude'
  | 'city_center_distance_km'
  | 'district_center_distance_km'
  | 'neighborhood_center_distance_km'
  | 'parcel_query_url'
  | 'parcel_query_url_auto'
  | 'tkgm_mahalle_id'
  | 'parcel_area'
  | 'parcel_quality'
  | 'parcel_locality'
  | 'parcel_sheet'
  | 'parcel_geometry'
  | 'tkgm_synced_at'
  | 'listing_text'
  | 'listing_generated_at'
  | 'listing_imar_detail'
>>;

export interface RepresentativeSettings {
  can_view_reservation_details: boolean;
  // Satış temsilcisinin ilerletebileceği son aşama (Django yönetim panelinden ayarlanır).
  max_stage?: 'REZERV' | 'KAPORA_ALINDI';
  // Arsa notlarını görme ve not ekleme (müşteri bilgisi görünürlüğünden bağımsız).
  can_add_notes?: boolean;
  // Çağrı merkezi: temsilci ekranını görür ama rezerv, kapora ve not işlemi yapamaz.
  read_only?: boolean;
}

export interface LandReservation {
  customer_name: string;
  customer_phone: string;
}

export const getRepresentativeLands = async (): Promise<RepresentativeLand[]> => {
  const { data } = await api.get('representative/lands/');
  return data;
};

export const getRepresentativeSettings = async (): Promise<RepresentativeSettings> => {
  const { data } = await api.get('representative/settings/');
  return data;
};

export const reserveLand = async (id: number, reservation: LandReservation): Promise<RepresentativeLand> => {
  const { data } = await api.post(`representative/lands/${id}/reserve/`, reservation);
  return data;
};

export interface LandDeposit {
  deposit_amount: string;
  id_front_image: File;
  id_back_image: File;
}

/** Rezervdeki arsayı kapora tutarı ve kimlik fotoğraflarıyla "Kapora Alındı"ya taşır (boş arsada önce rezerv gerekir). */
export const takeLandDeposit = async (id: number, deposit: LandDeposit): Promise<RepresentativeLand> => {
  const formData = new FormData();
  formData.append('deposit_amount', deposit.deposit_amount);
  formData.append('id_front_image', deposit.id_front_image);
  formData.append('id_back_image', deposit.id_back_image);
  const { data } = await api.post(`representative/lands/${id}/deposit/`, formData);
  return data;
};

/** Arsaya yeni not ekler; mevcut notlar değişmez, yeni not tarih ve kullanıcı adıyla sona yazılır. */
export const addRepresentativeLandNote = async (id: number, note: string): Promise<RepresentativeLand> => {
  const { data } = await api.post(`representative/lands/${id}/notes/`, { note });
  return data;
};

export type PresentationReportType = 'pptx' | 'pdf';

/** Yönetici: seçili dönemin satış özetini PowerPoint ya da PDF olarak indirir. */
export const downloadPresentationReport = async (
  type: PresentationReportType,
  range: { dateFrom?: string; dateTo?: string; periodLabel?: string },
): Promise<{ blob: Blob; fileName: string }> => {
  const params: Record<string, string> = { type };
  if (range.dateFrom) params.date_from = range.dateFrom;
  if (range.dateTo) params.date_to = range.dateTo;
  if (range.periodLabel) params.period_label = range.periodLabel;
  const response = await api.get<Blob>('reports/presentation/', { params, responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] ?? '');
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `satis-raporu.${type}`;
  return { blob: response.data, fileName };
};

export const getViewerUsers = async (): Promise<ViewerUser[]> => {
  const { data } = await api.get('users/');
  return data;
};

export const createViewerUser = async (
  username: string,
  password: string,
  role: Exclude<UserRole, 'admin'>,
): Promise<ViewerUser> => {
  const { data } = await api.post('users/', { username, password, role });
  return data;
};

export const getLands = async (): Promise<Land[]> => {
  const { data } = await api.get('lands/');
  return data;
};

export type LandUpdate = Partial<Pick<
  Land,
  | 'customer_name'
  | 'customer_phone'
  | 'reservation_notes'
  | 'deposit_amount'
  | 'sale_price'
  | 'down_payment'
>> & {
  status: LandStatus;
  installment_plan?: Land['installment_plan'];
  // Yalnızca arsa boşa alınırken gönderilir; müşterisi olan arsada zorunludur.
  cancel_reason?: CancelReason;
  cancel_detail?: CancelDetail;
  cancel_note?: string;
};

export const getLandStatusUpdate = (status: LandStatus): LandUpdate =>
  status === 'BOS'
    ? {
        status,
        customer_name: '',
        customer_phone: '',
        deposit_amount: null,
      }
    : { status };

export type NewLand = Pick<Land, 'il' | 'ilce' | 'mahalle' | 'ada' | 'parsel' | 'ownership_type' | 'hisse_no'> & {
  status: 'BOS';
  reservation_notes: string;
  deposit_amount: null;
};

export const createLand = async (land: NewLand): Promise<Land> => {
  const { data } = await api.post('lands/', land);
  return data;
};

export type LandStatusFiles = Partial<Record<'title_deed_image' | 'id_front_image' | 'id_back_image', File>>;

export const updateLandStatus = async (
  id: number,
  update: LandUpdate,
  files: LandStatusFiles = {},
): Promise<Land> => {
  let payload: LandUpdate | FormData = update;
  const fileEntries = Object.entries(files).filter((entry): entry is [string, File] => entry[1] instanceof File);
  if (fileEntries.length > 0) {
    const formData = new FormData();
    Object.entries(update).forEach(([key, value]) => {
      if (value === undefined) return;
      // Form gönderiminde boş değer, sunucuda "boşalt" (null) olarak okunur.
      if (value === null) {
        formData.append(key, '');
        return;
      }
      formData.append(key, key === 'installment_plan' ? JSON.stringify(value) : String(value));
    });
    fileEntries.forEach(([key, file]) => formData.append(key, file));
    payload = formData;
  }
  const { data } = await api.patch(`lands/${id}/change-status/`, payload);
  return data;
};

export const downloadTitleDeedImage = async (imageUrl: string): Promise<Blob> => {
  const url = new URL(imageUrl, api.defaults.baseURL);
  const { data } = await api.get<Blob>(url.toString(), { responseType: 'blob' });
  return data;
};

export const bulkCreateLands = async (lands: Omit<Land, 'id' | 'title_deed_image'>[]): Promise<Land[]> => {
  const { data } = await api.post('lands/bulk-create/', lands);
  return data;
};

export interface AuditLogEntry {
  id: number;
  actor_username: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: Record<string, unknown>;
  created_at: string;
}

export const getLandHistory = async (landId: number): Promise<AuditLogEntry[]> => {
  const { data } = await api.get(`lands/${landId}/history/`);
  return data.results;
};

export interface PaginatedAuditLogs {
  count: number;
  next: string | null;
  previous: string | null;
  results: AuditLogEntry[];
  actors: string[];
  actions: string[];
}

export interface AuditLogFilters {
  actor?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const getAuditLogs = async (
  page: number,
  filters: AuditLogFilters = {},
): Promise<PaginatedAuditLogs> => {
  const params: Record<string, string | number> = { page };
  if (filters.actor) params.actor = filters.actor;
  if (filters.action) params.action = filters.action;
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  const { data } = await api.get('audit-logs/', { params });
  return data;
};

export interface ActorAuditSummary {
  username: string;
  is_staff: boolean;
  role: UserRole;
  total: number;
  last_at: string | null;
  actions: Record<string, number>;
}

export interface CalendarEvent {
  id: string;
  actor_username: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: Record<string, unknown>;
  created_at: string;
}

export interface CalendarDay {
  date: string;
  events: CalendarEvent[];
}

export interface PaginatedAuditCalendar {
  results: CalendarDay[];
}

export const getAuditCalendar = async (
  filters: AuditLogFilters = {},
): Promise<PaginatedAuditCalendar> => {
  const params: Record<string, string> = {};
  if (filters.actor) params.actor = filters.actor;
  if (filters.action) params.action = filters.action;
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  const { data } = await api.get('audit-logs/calendar/', { params });
  return data;
};

export const getAuditLogSummary = async (
  filters: AuditLogFilters = {},
): Promise<{ results: ActorAuditSummary[] }> => {
  const params: Record<string, string> = {};
  if (filters.actor) params.actor = filters.actor;
  if (filters.action) params.action = filters.action;
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  const { data } = await api.get('audit-logs/summary/', { params });
  return data;
};

export interface SalesLeaderboardLand {
  land_id: number;
  reserved_at: string | null;
  deposit_at: string | null;
  sold_at: string | null;
}

export interface SalesLeaderboardRow {
  username: string;
  reservations: number;
  deposits: number;
  sales: number;
  amount: string;
  lands: SalesLeaderboardLand[];
}

export const getSalesLeaderboard = async (
  filters: Pick<AuditLogFilters, 'dateFrom' | 'dateTo'> = {},
): Promise<{ results: SalesLeaderboardRow[] }> => {
  const params: Record<string, string> = {};
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  const { data } = await api.get('dashboard/sales-leaderboard/', { params });
  return data;
};

export interface NotificationEntry {
  id: number;
  code: string;
  title: string;
  message: string;
  actor_username: string;
  related_username: string;
  target_type: string;
  target_id: string;
  is_read: boolean;
  created_at: string;
}

export interface PaginatedNotifications {
  count: number;
  next: string | null;
  previous: string | null;
  results: NotificationEntry[];
}

export interface NotificationQuery {
  userId?: number;
  unread?: boolean;
  page?: number;
}

export interface NotificationCounts {
  total: number;
  by_user: Record<string, number>;
}

export interface NotificationSettingEntry {
  code: string;
  label: string;
  description: string;
  title: string;
  enabled: boolean;
}

export const getNotifications = async (query: NotificationQuery = {}): Promise<PaginatedNotifications> => {
  const params: Record<string, string | number> = {};
  if (query.userId) params.user_id = query.userId;
  if (query.unread) params.unread = '1';
  if (query.page) params.page = query.page;
  const { data } = await api.get('notifications/', { params });
  return data;
};

export const getNotificationCounts = async (): Promise<NotificationCounts> => {
  const { data } = await api.get('notifications/counts/');
  return data;
};

export const markNotificationRead = async (id: number): Promise<NotificationEntry> => {
  const { data } = await api.post(`notifications/${id}/read/`);
  return data;
};

export const markAllNotificationsRead = async (userId?: number): Promise<{ updated: number }> => {
  const { data } = await api.post('notifications/read-all/', userId ? { user_id: userId } : {});
  return data;
};

export const getNotificationSettings = async (): Promise<{ settings: NotificationSettingEntry[] }> => {
  const { data } = await api.get('notifications/settings/');
  return data;
};

export const updateNotificationSettings = async (
  disabledCodes: string[],
): Promise<{ settings: NotificationSettingEntry[] }> => {
  const { data } = await api.put('notifications/settings/', { disabled_codes: disabledCodes });
  return data;
};

export interface FinanceSettings {
  monthly_interest_rate: string;
}

export const getFinanceSettings = async (): Promise<FinanceSettings> => {
  const { data } = await api.get('finance/settings/');
  return data;
};

export const updateFinanceSettings = async (monthlyInterestRate: string): Promise<FinanceSettings> => {
  const { data } = await api.put('finance/settings/', { monthly_interest_rate: monthlyInterestRate });
  return data;
};

export type CancelReason =
  | 'fiyat_odeme'
  | 'baska_arsa'
  | 'ozellik'
  | 'yerinde_gordu'
  | 'yanlis_yer'
  | 'ulasilamiyor'
  | 'diger'
  | 'devredildi';

export type CancelDetail =
  | 'odeme_karsilanamadi'
  | 'kredi_cikmadi'
  | 'fiyat_anlasilamadi'
  | 'taksit_anlasilamadi'
  | 'bizden_aldi'
  | 'rakipten_aldi'
  | 'imar'
  | 'yol_cephe'
  | 'hisseli'
  | 'donus_yok'
  | 'sure_doldu'
  | 'kisisel';

export type CustomerSource = '' | 'referans' | 'ilan' | 'sosyal_medya' | 'web' | 'ofis' | 'telefon' | 'diger';

export interface Customer {
  id: number;
  full_name: string;
  phone: string;
  national_id: string;
  source: CustomerSource;
  notes: string;
  created_at: string;
  updated_at: string;
  purchased_count: number;
  purchased_total: string | null;
  active_count: number;
  cancelled_count: number;
  last_activity_at: string | null;
  last_il: string | null;
  last_ilce: string | null;
  last_cancel_reason: CancelReason | '' | null;
  last_cancel_detail: CancelDetail | '' | null;
}

export interface CustomerLandRecord {
  id: number;
  land: number | null;
  land_label: string;
  il: string;
  ilce: string;
  land_status: LandStatus | null;
  highest_status: LandStatus;
  outcome: 'active' | 'sold' | 'cancelled';
  deposit_amount: string | null;
  sale_price: string | null;
  representative_username: string | null;
  started_at: string;
  ended_at: string | null;
  cancel_reason: CancelReason | '';
  cancel_detail: CancelDetail | '';
  cancel_note: string;
}

export interface CustomerDetail extends Customer {
  records: CustomerLandRecord[];
}

export type CustomerInput = Pick<Customer, 'full_name' | 'phone' | 'national_id' | 'source' | 'notes'>;

export const getCustomers = async (): Promise<Customer[]> => {
  const { data } = await api.get('customers/');
  return data;
};

export const getCustomer = async (id: number): Promise<CustomerDetail> => {
  const { data } = await api.get(`customers/${id}/`);
  return data;
};

export const createCustomer = async (customer: CustomerInput): Promise<Customer> => {
  const { data } = await api.post('customers/', customer);
  return data;
};

export const updateCustomer = async (id: number, customer: Partial<CustomerInput>): Promise<CustomerDetail> => {
  const { data } = await api.patch(`customers/${id}/`, customer);
  return data;
};

export interface CancelReasonSummary {
  total: number;
  results: {
    reason: CancelReason | '';
    label: string;
    count: number;
    details: { detail: CancelDetail | ''; label: string; count: number }[];
  }[];
}

export const getCancelReasons = async (): Promise<CancelReasonSummary> => {
  const { data } = await api.get('customers/cancel-reasons/');
  return data;
};

export interface LandLocationUpdate {
  latitude: string | null;
  longitude: string | null;
  parcel_query_url: string;
}

export const updateLandLocation = async (id: number, location: LandLocationUpdate): Promise<Land> => {
  const { data } = await api.patch(`lands/${id}/`, location);
  return data;
};

// TKGM'de parsel bulunamazsa 404 ile ilçedeki mahalleler döner; doğrusu seçilip mahalleId ile tekrar denenir.
export interface TkgmNeighborhoodChoice {
  id: number;
  name: string;
}

/** Satış temsilcisi ve çağrı merkezi: arsanın TKGM bilgilerini getirir (başka alan değişmez). */
export const syncRepresentativeLandFromTkgm = async (id: number, mahalleId?: number): Promise<RepresentativeLand> => {
  const { data } = await api.post(`representative/lands/${id}/tkgm-sync/`, mahalleId ? { mahalle_id: mahalleId } : {});
  return data;
};

/** Yalnızca çağrı merkezi: arsanın bilgilerinden Claude ile ilan metni üretir ve arsaya kaydeder. */
/** Çağrı merkezi: belgeden imar detayını arsaya kaydeder. */
export const updateListingImarDetail = async (id: number, imarDetail: string): Promise<{ listing_imar_detail: string }> => {
  const { data } = await api.patch(`lands/${id}/listing/imar/`, { listing_imar_detail: imarDetail });
  return data;
};

export const generateLandListing = async (id: number): Promise<{ listing_text: string; listing_generated_at: string }> => {
  const { data } = await api.post(`lands/${id}/listing/`);
  return data;
};

export const syncLandFromTkgm = async (id: number, mahalleId?: number): Promise<Land> => {
  const { data } = await api.post(`lands/${id}/tkgm-sync/`, mahalleId ? { mahalle_id: mahalleId } : {});
  return data;
};

// Yeni arsa formundaki il → ilçe → mahalle seçimleri (TKGM listeleri, sunucu üzerinden).
export interface TkgmUnit {
  id: number;
  name: string;
}

export const getTkgmProvinces = async (): Promise<TkgmUnit[]> => {
  const { data } = await api.get('tkgm/il/');
  return data;
};

export const getTkgmDistricts = async (provinceId: number, provinceName: string): Promise<TkgmUnit[]> => {
  const { data } = await api.get(`tkgm/il/${provinceId}/ilce/`, { params: { il: provinceName } });
  return data;
};

export const getTkgmNeighborhoods = async (districtId: number, districtName: string): Promise<TkgmUnit[]> => {
  const { data } = await api.get(`tkgm/ilce/${districtId}/mahalle/`, { params: { ilce: districtName } });
  return data;
};
