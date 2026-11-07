// Arsa konumu için yardımcılar: koordinat ayrıştırma ve harita / Parsel Sorgu bağlantıları.

export const PARCEL_QUERY_HOME = 'https://parselsorgu.tkgm.gov.tr/';

// "41.0123, 28.9876", "41,0123 28,9876" ya da Google Maps linki (…/@41.01,28.98,… veya ?q=41.01,28.98).
export const parseCoordinates = (input: string): { latitude: number; longitude: number } | null => {
  const text = input.trim();
  if (!text) return null;
  // Yer sayfasında iğnenin tam yeri !3d…!4d…'dadır; @… yalnızca ekranın ortasıdır.
  const fromUrl =
    text.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) ??
    text.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i) ??
    text.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  const plain = text.match(/^(-?\d{1,2}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)$/);
  const match = fromUrl ?? plain;
  if (!match) return null;
  const latitude = Number(match[1].replace(',', '.'));
  const longitude = Number(match[2].replace(',', '.'));
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
};

export const formatCoordinates = (latitude: string | number, longitude: string | number) =>
  `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;

export const mapsUrl = (latitude: string | number, longitude: string | number) =>
  `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

export const directionsUrl = (latitude: string | number, longitude: string | number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

// Anahtar gerektirmeyen OpenStreetMap gömülü harita (işaretçili).
export const embeddedMapUrl = (latitude: string | number, longitude: string | number) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const delta = 0.006;
  const bbox = [lng - delta, lat - delta * 0.6, lng + delta, lat + delta * 0.6].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
};
