import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BellOff, CheckCheck, UserRound, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api';
import type { ViewerUser } from '../api';

const formatTime = (value: string) =>
  new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

interface UserNotificationPanelProps {
  user: ViewerUser | null;
  onClose: () => void;
}

export default function UserNotificationPanel({ user, onClose }: UserNotificationPanelProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const listQuery = useQuery({
    queryKey: ['notifications', 'user', user?.id],
    queryFn: () => getNotifications({ userId: user!.id }),
    enabled: Boolean(user),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notificationCounts'] });
  };

  const readOneMutation = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(user?.id),
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!user) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [user, onClose]);

  const notifications = listQuery.data?.results ?? [];
  const unreadCount = notifications.filter(item => !item.is_read).length;

  return (
    <AnimatePresence>
      {user && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', damping: 25, stiffness: 240 }}
            onClick={event => event.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <UserRound size={18} className="text-slate-500" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{user.username}</h2>
                  <p className="text-sm text-slate-500">
                    Bildirimler{unreadCount > 0 ? ` · ${unreadCount} okunmamış` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={unreadCount === 0 || readAllMutation.isPending}
                  onClick={() => readAllMutation.mutate()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <CheckCheck size={14} />
                  Tümünü okundu işaretle
                </button>
                <button
                  type="button"
                  aria-label="Kapat"
                  onClick={onClose}
                  className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {listQuery.isLoading && (
                <p className="py-8 text-center text-sm text-slate-500">Bildirimler yükleniyor...</p>
              )}
              {listQuery.isError && (
                <p role="alert" className="py-8 text-center text-sm text-red-600">
                  Bildirimler yüklenemedi: {listQuery.error.message}
                </p>
              )}
              {listQuery.data && notifications.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <BellOff size={28} />
                  <p className="text-sm">Bu kullanıcıyla ilgili henüz bildirim yok.</p>
                </div>
              )}
              <ul className="divide-y-2 divide-slate-300">
                {notifications.map(notification => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!notification.is_read) readOneMutation.mutate(notification.id);
                        if (notification.target_type === 'land' && /^\d+$/.test(notification.target_id)) {
                          onClose();
                          navigate(`/land/${notification.target_id}`);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-colors ${
                        notification.is_read
                          ? 'bg-white hover:bg-slate-50'
                          : 'bg-blue-50/70 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium text-slate-800">{notification.title}</span>
                        {!notification.is_read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">{formatTime(notification.created_at)}</span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {notification.code}
                        </code>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
