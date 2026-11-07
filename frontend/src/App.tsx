import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getCurrentUser } from './api';
import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import KanbanBoard from './components/KanbanBoard';
import BulkImport from './components/BulkImport';
import AvailableLandsPage from './components/AvailableLandsPage';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import SettingsPage from './components/SettingsPage';
import AuditLogPage from './components/AuditLogPage';
import ActivityCalendarPage from './components/ActivityCalendarPage';
import DashboardPage from './components/DashboardPage';
import ReportsPage from './components/ReportsPage';
import CustomersPage from './components/CustomersPage';
import CustomerDetailPage from './components/CustomerDetailPage';
import LandDetailsPage from './components/LandDetailsPage';
import LandHistoryPage from './components/LandHistoryPage';

// Bu sayfalar 1600px sınırı olmadan tüm genişliği kullanır.
const FULL_WIDTH_PATHS = ['/', '/board'];

function App() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    retry: false,
  });

  if (location.pathname === '/login') {
    if (isLoading) return <div className="flex min-h-screen items-center justify-center text-slate-500">Oturum kontrol ediliyor...</div>;
    if (user) return <Navigate to={user.role === 'admin' ? '/' : user.role === 'sales_support' ? '/board' : '/available-lands'} replace />;
    return <Login />;
  }

  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-slate-500">Oturum kontrol ediliyor...</div>;
  if (!user) {
    if (axios.isAxiosError(error) && error.response?.status !== 401) {
      return <div role="alert" className="p-8 text-red-600">Oturum bilgisi alınamadı: {error.message}</div>;
    }
    return <Navigate to="/login" replace />;
  }
  const userHomePath = user.role === 'admin' ? '/' : user.role === 'sales_support' ? '/board' : '/available-lands';
  // Satış destek arsa detaylarını ve müşteri kartlarını da açabilir.
  const isSupportDetailPath = /^\/(land\/\d+(\/history)?|customers\/\d+)$/.test(location.pathname);
  const allowedPaths = user.role === 'sales_support'
    ? ['/board', '/import', '/customers']
    : [userHomePath];
  if (user.role !== 'admin' && !(user.role === 'sales_support' && isSupportDetailPath) && !allowedPaths.includes(location.pathname)) {
    return <Navigate to={userHomePath} replace />;
  }
  if (user.role === 'admin' && location.pathname === '/available-lands') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-[100dvh] min-w-0 overflow-hidden bg-[#f5f7fc] font-sans text-slate-800">
      <Sidebar
        role={user.role}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar user={user} onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="relative min-h-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className={`mx-auto flex min-h-full w-full flex-col ${FULL_WIDTH_PATHS.includes(location.pathname) ? '' : 'max-w-[1600px]'}`}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/board" element={<KanbanBoard isSalesSupport={user.role === 'sales_support'} />} />
              <Route path="/land/:landId" element={<LandDetailsPage isSalesSupport={user.role === 'sales_support'} />} />
              <Route path="/land/:landId/history" element={<LandHistoryPage />} />
              <Route path="/import" element={<BulkImport isSalesSupport={user.role === 'sales_support'} />} />
              <Route path="/available-lands" element={<AvailableLandsPage />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/audit-logs" element={<AuditLogPage />} />
              <Route path="/reports" element={<Navigate to="/reports/region" replace />} />
              <Route path="/reports/region" element={<ReportsPage tab="region" />} />
              <Route path="/reports/person" element={<ReportsPage tab="personnel" />} />
              <Route path="/activity-calendar" element={<ActivityCalendarPage />} />
              <Route path="/customers" element={<CustomersPage isAdmin={user.role === 'admin'} />} />
              <Route path="/customers/:customerId" element={<CustomerDetailPage isAdmin={user.role === 'admin'} />} />
              <Route path="*" element={<Navigate to={userHomePath} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
