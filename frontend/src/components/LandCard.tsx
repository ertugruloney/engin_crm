import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MapPin, Maximize2, StickyNote } from 'lucide-react';
import { statusColors, statusLabels } from '../types';
import type { Land } from '../types';

interface LandCardProps {
  land: Land;
  isDragging?: boolean;
  isReadOnly?: boolean;
  onClick?: () => void;
}

export default function LandCard({ land, isDragging, isReadOnly = false, onClick }: LandCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-panel p-4 rounded-xl transition-all hover:shadow-lg group ${
        isReadOnly ? 'cursor-default' : 'cursor-pointer active:cursor-grab'
      } ${
        isDragging ? 'opacity-80 scale-105 shadow-xl ring-2 ring-blue-400' : 'hover:-translate-y-1'
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <span className="font-bold text-slate-800 text-lg">Parsel {land.parsel}</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[land.status]}`}>
          {statusLabels[land.status]}
        </span>
      </div>
      
      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-slate-600">
          <MapPin size={14} className="mr-2 text-slate-400 shrink-0" />
          <span className="truncate" title={`${land.il}, ${land.ilce}, ${land.mahalle}`}>
            {land.il}, {land.ilce}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
            <span className="block text-slate-400 mb-0.5">Ada</span>
            <span className="font-medium text-slate-700">{land.ada}</span>
          </div>
          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
            <span className="block text-slate-400 mb-0.5">Mahalle</span>
            <span className="font-medium text-slate-700 truncate">{land.mahalle}</span>
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <StickyNote size={13} />
          Not
        </div>
        <p
          className={`line-clamp-2 break-words text-xs ${land.reservation_notes ? 'text-slate-700' : 'italic text-slate-400'}`}
          title={land.reservation_notes || 'Not eklenmemiş'}
        >
          {land.reservation_notes || 'Not eklenmemiş'}
        </p>
      </div>
      
      <div className="pt-3 border-t border-slate-100 flex justify-end">
        {!isReadOnly && (
          <button className="flex items-center text-xs font-medium text-blue-600 transition-opacity hover:text-blue-700">
            Detayları Gör <Maximize2 size={12} className="ml-1" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SortableLandCard({ land, onClick }: { land: Land; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: land.id.toString(),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LandCard land={land} isDragging={isDragging} onClick={onClick} />
    </div>
  );
}
