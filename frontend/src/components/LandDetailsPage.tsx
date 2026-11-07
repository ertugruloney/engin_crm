import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getLands } from '../api';
import headerImage from '../assets/header.png';
import LandDrawer from './Drawer';

interface LandDetailsPageProps {
  isSalesSupport: boolean;
}

export default function LandDetailsPage({ isSalesSupport }: LandDetailsPageProps) {
  const { landId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: lands = [], isLoading, isError, error } = useQuery({
    queryKey: ['lands'],
    queryFn: getLands,
  });
  const land = lands.find(item => item.id === Number(landId));
  const fallbackPath = isSalesSupport ? '/board' : '/';
  const returnPath =
    typeof location.state?.from === 'string' && location.state.from.startsWith('/')
      ? location.state.from
      : fallbackPath;

  if (isLoading) return <div className="py-12 text-center text-slate-500">Arsa bilgileri yükleniyor...</div>;
  if (isError) return <div role="alert" className="py-12 text-center text-red-600">Arsa bilgileri yüklenemedi: {error.message}</div>;
  if (!land) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-600">Arsa kaydı bulunamadı.</p>
        <button type="button" onClick={() => navigate(returnPath)} className="mt-4 font-medium text-blue-600 hover:text-blue-700">
          Panoya dön
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full flex-1 flex-col gap-4">
      <img
        src={headerImage}
        alt="Arsa ve gayrimenkul planı"
        className="h-auto max-h-56 w-full shrink-0 rounded-xl object-cover object-center sm:max-h-72 lg:max-h-80"
      />
      <LandDrawer
        key={land.id}
        land={land}
        embedded
        onClose={() => navigate(returnPath)}
        onHistoryClick={() => navigate(`/land/${land.id}/history`, { state: { from: returnPath } })}
      />
    </div>
  );
}
