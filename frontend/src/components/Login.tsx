import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogIn } from 'lucide-react';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { login } from '../api';
import type { AppUser } from '../api';
import logo from '../assets/formlogo.png';

export default function Login() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (user: AppUser) => {
      queryClient.setQueryData(['currentUser'], user);
      navigate(
        user.role === 'admin' ? '/board' : user.role === 'sales_support' ? '/board' : '/available-lands',
        { replace: true },
      );
    },
  });

  const errorMessage = mutation.error
    ? isAxiosError<{ detail?: string }>(mutation.error)
      ? mutation.error.response?.data.detail || mutation.error.message
      : mutation.error.message
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        {/* Logo beyaz ve şeffaf zeminli; menüyle aynı lacivert şeritte gösterilir. */}
        <div className="flex justify-center bg-gradient-to-br from-[#0f1d3d] via-[#13254f] to-[#182f63] px-8 py-6">
          <img src={logo} alt="Engin Arsa" className="h-20 w-56 object-contain" />
        </div>
        <div className="p-8">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold text-slate-800">Engin Gayrimenkul</h1>
          <p className="mt-1 text-sm text-slate-500">Arsa yönetim sistemine giriş yapın.</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block text-sm font-medium text-slate-700">
            Kullanıcı adı
            <input
              autoComplete="username"
              required
              value={username}
              onChange={event => setUsername(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Parola
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          {errorMessage && <p role="alert" className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <LogIn size={17} />
            {mutation.isPending ? 'Oturum açılıyor...' : 'Oturum Aç'}
          </button>
        </form>
        </div>
      </section>
    </main>
  );
}
