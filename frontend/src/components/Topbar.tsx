import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Menu } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api';
import type { AppUser } from '../api';
import NotificationBell from './NotificationBell';

const ROLE_LABELS: Record<AppUser['role'], string> = {
  admin: 'Yönetici',
  sales_support: 'Satış Destek',
  sales_representative: 'Satış Temsilcisi',
};

// "mert.engin" -> "ME", "mert" -> "ME"
const getInitials = (username: string) => {
  const parts = username.split(/[\s._-]+/).filter(Boolean);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return initials.toLocaleUpperCase('tr-TR');
};

export default function Topbar({ user, onMenuClick }: { user: AppUser; onMenuClick: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 sm:px-6 lg:px-8">
      <button
        type="button"
        aria-label="Menüyü aç"
        onClick={onMenuClick}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
      >
        <Menu size={20} />
      </button>
      <span className="hidden md:block" />

      <div className="flex items-center gap-3 sm:gap-5">
        {user.role === 'admin' && <NotificationBell />}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
            className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
              {getInitials(user.username)}
            </span>
            <span className="max-w-[8rem] truncate text-sm font-medium text-slate-800 sm:max-w-[14rem]">
              {user.username}
            </span>
            <ChevronDown size={16} className={`text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-xl"
            >
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="truncate text-sm font-semibold text-slate-800">{user.username}</p>
                <p className="mt-0.5 text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <LogOut size={16} />
                Çıkış Yap
              </button>
              {logoutMutation.isError && (
                <p role="alert" className="px-4 pb-2 text-xs text-red-600">Çıkış yapılamadı.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
