import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, UserPlus, Users } from 'lucide-react';
import { createViewerUser, getNotificationCounts, getViewerUsers } from '../api';
import type { UserRole } from '../api';
import type { ViewerUser } from '../api';
import UserNotificationPanel from './UserNotificationPanel';

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('sales_representative');
  const [selectedUser, setSelectedUser] = useState<ViewerUser | null>(null);
  const usersQuery = useQuery({ queryKey: ['viewerUsers'], queryFn: getViewerUsers });
  const countsQuery = useQuery({
    queryKey: ['notificationCounts'],
    queryFn: getNotificationCounts,
    refetchInterval: 30000,
  });
  const createMutation = useMutation({
    mutationFn: () => createViewerUser(username, password, role),
    onSuccess: async () => {
      setUsername('');
      setPassword('');
      setRole('sales_representative');
      await queryClient.invalidateQueries({ queryKey: ['viewerUsers'] });
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-800">Kullanıcı Yönetimi</h1>
        <p className="mt-1 text-slate-500">Satış ekibi için kullanıcı hesabı oluşturun.</p>
      </div>

      <form
        onSubmit={event => {
          event.preventDefault();
          createMutation.mutate();
        }}
        className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800"><UserPlus size={18} /> Satış ekibi kullanıcısı ekle</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Rol
            <select
              value={role}
              onChange={event => setRole(event.target.value as Exclude<UserRole, 'admin'>)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="sales_representative">Satış Temsilcisi</option>
              <option value="sales_support">Satış Destek</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Kullanıcı adı
            <input
              required
              maxLength={150}
              autoComplete="off"
              value={username}
              onChange={event => setUsername(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            İlk parola (en az 8 karakter)
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        {createMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            Kullanıcı oluşturulamadı: {createMutation.error.message}
          </p>
        )}
        {createMutation.isSuccess && (
          <p role="status" className="mt-3 text-sm text-green-700">Kullanıcı hesabı oluşturuldu.</p>
        )}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Oluşturuluyor...' : 'Hesap oluştur'}
        </button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-800"><Users size={18} /> Satış ekibi</h2>
        <p className="mb-4 text-sm text-slate-500">Bir kullanıcıya tıklayarak onunla ilgili bildirimleri görüntüleyin.</p>
        {usersQuery.isLoading && <p className="text-sm text-slate-500">Kullanıcılar yükleniyor...</p>}
        {usersQuery.isError && <p role="alert" className="text-sm text-red-600">Kullanıcılar yüklenemedi: {usersQuery.error.message}</p>}
        {usersQuery.data && usersQuery.data.length === 0 && <p className="text-sm text-slate-500">Henüz satış ekibi hesabı yok.</p>}
        {usersQuery.data && usersQuery.data.length > 0 && (
          <ul className="divide-y-2 divide-slate-300">
            {usersQuery.data.map(user => {
              const unreadCount = countsQuery.data?.by_user[String(user.id)] ?? 0;
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(user)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-700">{user.username}</span>
                    <span className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          <Bell size={12} />
                          {unreadCount}
                        </span>
                      )}
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                        user.role === 'sales_support'
                          ? 'bg-violet-50 text-violet-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {user.role === 'sales_support' ? 'Satış Destek' : 'Satış Temsilcisi'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <UserNotificationPanel user={selectedUser} onClose={() => setSelectedUser(null)} />
    </div>
  );
}
