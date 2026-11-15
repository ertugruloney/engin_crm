import type { Land } from '../types';

type CenterDistances = Pick<
  Land,
  'city_center_distance_km' | 'district_center_distance_km' | 'neighborhood_center_distance_km'
>;

const formatDistance = (distance: number | null | undefined) =>
  distance == null ? '—' : `${distance.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`;

export default function CenterDistancesInline({ land }: { land: CenterDistances }) {
  return (
    <div aria-label="Kuş uçuşu merkez uzaklıkları" className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-600">
      <span>İl: {formatDistance(land.city_center_distance_km)}</span>
      <span>İlçe: {formatDistance(land.district_center_distance_km)}</span>
      <span>Mahalle: {formatDistance(land.neighborhood_center_distance_km)}</span>
    </div>
  );
}
