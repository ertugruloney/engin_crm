export const FILTER_FIELDS = ['il', 'ilce', 'mahalle', 'ada', 'parsel'] as const;

export type FilterField = (typeof FILTER_FIELDS)[number];

export type FilterVisibility = Record<FilterField, boolean>;

export const DEFAULT_FILTER_VISIBILITY: FilterVisibility = {
  il: true,
  ilce: true,
  mahalle: true,
  ada: true,
  parsel: true,
};

const STORAGE_KEY = 'arsa-crm-filter-visibility';

const isFilterVisibility = (value: unknown): value is FilterVisibility => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return FILTER_FIELDS.every(field => typeof record[field] === 'boolean');
};

export const loadFilterVisibility = (): FilterVisibility => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_FILTER_VISIBILITY;

  const value: unknown = JSON.parse(stored);
  if (!isFilterVisibility(value)) {
    throw new Error('Kayıtlı filtre ayarları geçersiz.');
  }
  return value;
};

export const saveFilterVisibility = (visibility: FilterVisibility): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
};
