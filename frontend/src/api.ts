import axios from 'axios';
import type { Land, LandStatus } from './types';

export type UserRole = 'admin' | 'sales_representative' | 'sales_support';

export interface AppUser {
  id: number;
  username: string;
  role: UserRole;
}

const api = axios.create({
  baseURL: 'http://localhost:8000/api/',
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
> & Partial<Pick<
  Land,
  | 'reservation_date'
  | 'customer_name'
  | 'customer_phone'
  | 'reservation_notes'
>>;

export interface RepresentativeSettings {
  can_view_reservation_details: boolean;
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

export const updateRepresentativeLandNotes = async (
  id: number,
  reservation_notes: string,
): Promise<RepresentativeLand> => {
  const { data } = await api.patch(`representative/lands/${id}/notes/`, { reservation_notes });
  return data;
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
>> & { status: LandStatus; installment_plan?: Land['installment_plan'] };

export const getLandStatusUpdate = (status: LandStatus): LandUpdate =>
  status === 'BOS'
    ? {
        status,
        customer_name: '',
        customer_phone: '',
        deposit_amount: null,
      }
    : { status };

export type NewLand = Pick<Land, 'il' | 'ilce' | 'mahalle' | 'ada' | 'parsel'> & {
  status: 'BOS';
  reservation_notes: string;
  deposit_amount: null;
};

export const createLand = async (land: NewLand): Promise<Land> => {
  const { data } = await api.post('lands/', land);
  return data;
};

export const updateLandStatus = async (
  id: number,
  update: LandUpdate,
  titleDeedImage?: File,
): Promise<Land> => {
  let payload: LandUpdate | FormData = update;
  if (titleDeedImage) {
    const formData = new FormData();
    Object.entries(update).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, key === 'installment_plan' ? JSON.stringify(value) : String(value));
    });
    formData.append('title_deed_image', titleDeedImage);
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
