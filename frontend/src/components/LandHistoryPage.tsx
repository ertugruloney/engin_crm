import { ArrowLeft, MapPin } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import LandHistory from './LandHistory';

export default function LandHistoryPage() {
  const { landId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath =
    typeof location.state?.from === 'string' && location.state.from.startsWith('/')
      ? location.state.from
      : '/';

  if (!landId || !/^\d+$/.test(landId)) {
    return <div role="alert" className="py-12 text-center text-red-600">Geçersiz arsa numarası.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(`/land/${landId}`, { state: { from: returnPath } })}
        className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
      >
        <ArrowLeft size={17} />
        Arsa detaylarına dön
      </button>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
          <MapPin size={20} className="shrink-0 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">Arsa işlem geçmişi</h1>
            <p className="mt-1 text-sm text-slate-500">Bu arsada yapılan işlemler ve değişiklikler</p>
          </div>
        </div>
        <LandHistory landId={Number(landId)} />
      </div>
    </div>
  );
}
