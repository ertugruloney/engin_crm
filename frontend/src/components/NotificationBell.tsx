import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getNotificationCounts,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api';

const formatTime = (value: string) =>
  new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export default function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const countsQuery = useQuery({
    queryKey: ['notificationCounts'],
    queryFn: getNotificationCounts,
    refetchInterval: 30000,
  });
  const listQuery = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => getNotifications(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notificationCounts'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const readOneMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: refresh,
  });
  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: refresh,
  });

  const unreadTotal = countsQuery.data?.total ?? 0;
  const notifications = listQuery.data?.results ?? [];

  return (
    <div ref={containerRef}>
      <button
        type="button"
        aria-label={`Bildirimler${unreadTotal > 0 ? ` (${unreadTotal} okunmamış)` : ''}`}
        onClick={() => setOpen(current => !current)}
        className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
      >
        <Bell size={20} />
        {unreadTotal > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white border border-white">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-semibold text-slate-800">Bildirimler</span>
            <button
              type="button"
              disabled={unreadTotal === 0 || readAllMutation.isPending}
              onClick={() => readAllMutation.mutate()}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40"
            >
              <CheckCheck size={14} />
              Tümünü okundu işaretle
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {listQuery.isLoading && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Bildirimler yükleniyor...</p>
            )}
            {listQuery.isError && (
              <p role="alert" className="px-4 py-6 text-center text-sm text-red-600">
                Bildirimler yüklenemedi: {listQuery.error.message}
              </p>
            )}
            {listQuery.data && notifications.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Yeni bildirim yok.</p>
            )}
            {notifications.map(notification => (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  if (!notification.is_read) readOneMutation.mutate(notification.id);
                  if (notification.target_type === 'land' && /^\d+$/.test(notification.target_id)) {
                    setOpen(false);
                    navigate(`/land/${notification.target_id}`);
                  }
                }}
                className={`block w-full border-b-2 border-slate-300 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                  notification.is_read ? 'bg-white' : 'bg-blue-50/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-slate-800">{notification.title}</span>
                  {!notification.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                </div>
                <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">{formatTime(notification.created_at)}</span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{notification.code}</code>
                </div>
              </button>
            ))}
          </div>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings size={15} />
            Bildirim ayarları
          </Link>
        </div>
      )}
    </div>
  );
}
