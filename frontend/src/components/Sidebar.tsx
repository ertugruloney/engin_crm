import { motion } from 'framer-motion';
import { BarChart3, Briefcase, Calendar, Contact, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Home, List, Map, MapPin, Settings, UploadCloud, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { UserRole } from '../api';
import logo from '../assets/formlogo.png';

interface SidebarProps {
  role: UserRole;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

// Menünün altındaki şehir silüeti: [x, genişlik, yükseklik] (viewBox 260x220).
const SKYLINE_BACK: [number, number, number][] = [
  [0, 22, 90], [20, 18, 120], [36, 26, 80], [60, 16, 140], [74, 24, 105], [96, 20, 160],
  [114, 28, 95], [140, 18, 130], [156, 24, 175], [178, 22, 110], [198, 18, 150], [214, 26, 100], [238, 22, 125],
];
const SKYLINE_FRONT: [number, number, number][] = [
  [6, 20, 55], [24, 16, 75], [40, 22, 50], [64, 18, 85], [84, 24, 60], [110, 14, 95],
  [126, 22, 70], [150, 18, 60], [170, 26, 90], [198, 16, 65], [216, 22, 80], [240, 20, 55],
];

function Skyline() {
  return (
    <svg
      viewBox="0 0 260 220"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full"
    >
      <defs>
        <linearGradient id="skylineFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b5ba5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {SKYLINE_BACK.map(([x, width, height]) => (
        <rect key={`b-${x}`} x={x} y={220 - height} width={width} height={height} fill="url(#skylineFade)" opacity="0.6" />
      ))}
      {SKYLINE_FRONT.map(([x, width, height]) => (
        <rect key={`f-${x}`} x={x} y={220 - height} width={width} height={height} fill="#13285a" opacity="0.9" />
      ))}
    </svg>
  );
}

type MenuLink = { icon: typeof Home; label: string; path: string };
type MenuGroup = { icon: typeof Home; label: string; children: MenuLink[] };
type MenuItem = MenuLink | MenuGroup;

const SALES_LINKS: MenuLink[] = [
  { icon: List, label: 'Satış Panosu', path: '/board' },
  { icon: UploadCloud, label: 'Toplu Arsa Ekle', path: '/import' },
];

const CUSTOMERS_LINK: MenuLink = { icon: Contact, label: 'Müşteriler', path: '/customers' };

const REPORT_LINKS: MenuLink[] = [
  { icon: MapPin, label: 'Bölgelere Göre', path: '/reports/region' },
  { icon: UserRound, label: 'Kişilere Göre', path: '/reports/person' },
];

export default function Sidebar({ role, mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  // Açık gruplar; sayfa açılışında aktif sayfanın grubu açık başlar.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (SALES_LINKS.some(link => link.path === location.pathname)) initial.add('Satış Yönetimi');
    if (REPORT_LINKS.some(link => link.path === location.pathname)) initial.add('Raporlar');
    return initial;
  });
  const toggleGroup = (label: string) =>
    setOpenGroups(current => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const adminMenuItems: MenuItem[] = [
    { icon: Home, label: 'Ana Sayfa', path: '/' },
    { icon: Briefcase, label: 'Satış Yönetimi', children: SALES_LINKS },
    CUSTOMERS_LINK,
    { icon: BarChart3, label: 'Raporlar', children: REPORT_LINKS },
    { icon: Users, label: 'Kullanıcı Yönetimi', path: '/users' },
    { icon: ClipboardList, label: 'Denetim Kayıtları', path: '/audit-logs' },
    { icon: Calendar, label: 'İşlem Takvimi', path: '/activity-calendar' },
    { icon: Settings, label: 'Ayarlar', path: '/settings' },
  ];
  const menuItems: MenuItem[] = role === 'admin'
    ? adminMenuItems
    : role === 'sales_support'
      ? [...SALES_LINKS, CUSTOMERS_LINK]
      : [{ icon: Map, label: 'Arsalar', path: '/available-lands' }];
  const homePath = role === 'admin' ? '/' : role === 'sales_support' ? '/board' : '/available-lands';

  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-lg px-3 py-2.5 text-sm transition-colors ${collapsed ? 'justify-center' : ''} ${
      isActive
        ? 'bg-blue-600 font-semibold text-white shadow-lg shadow-blue-900/40'
        : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`;

  const renderLink = (item: MenuLink, nested = false) => (
    <Link
      key={item.path}
      to={item.path}
      onClick={onMobileClose}
      title={collapsed ? item.label : undefined}
      className={`${linkClass(location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)))} ${nested && !collapsed ? 'pl-10' : ''}`}
    >
      <item.icon size={nested ? 16 : 18} className="shrink-0" />
      {!collapsed && <span className="ml-3 truncate">{item.label}</span>}
    </Link>
  );

  return (
    <>
    {mobileOpen && (
      <button
        type="button"
        aria-label="Menüyü kapat"
        onClick={onMobileClose}
        className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm md:hidden"
      />
    )}
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 80 : 240 }}
      className={`h-[100dvh] shrink-0 overflow-hidden bg-gradient-to-b from-[#0f1d3d] via-[#13254f] to-[#182f63] py-6 text-white ${
        mobileOpen ? 'fixed inset-y-0 left-0 z-50 flex w-[min(82vw,240px)] flex-col' : 'hidden md:relative md:flex md:flex-col'
      }`}
    >
      <Skyline />

      {mobileOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          onClick={onMobileClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-2 text-slate-300 hover:bg-white/10 md:hidden"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <button
        type="button"
        aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
        onClick={() => setCollapsed(!collapsed)}
        className="absolute right-2 top-7 z-10 hidden rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white md:block"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <div className="relative">
        <Link
          to={homePath}
          onClick={onMobileClose}
          className={`mb-10 flex items-center ${collapsed ? 'justify-center px-2 pt-6' : 'px-5'}`}
        >
          <img
            src={logo}
            alt="Engin Arsa"
            className={`object-contain ${collapsed ? 'h-10 w-14' : 'h-20 w-full'}`}
          />
        </Link>

        <nav className="space-y-1.5 px-3">
          {menuItems.map(item => {
            if (!('children' in item)) return renderLink(item);
            const childActive = item.children.some(child => child.path === location.pathname);
            const open = openGroups.has(item.label) || collapsed;
            return (
              <div key={item.label} className="space-y-1">
                <button
                  type="button"
                  aria-expanded={open}
                  title={collapsed ? item.label : undefined}
                  onClick={() => toggleGroup(item.label)}
                  className={`${linkClass(false)} w-full ${childActive && !open ? 'text-white' : ''}`}
                >
                  <item.icon size={18} className="shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="ml-3 flex-1 truncate text-left">{item.label}</span>
                      <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>
                {open && item.children.map(child => renderLink(child, true))}
              </div>
            );
          })}
        </nav>
      </div>

      {!collapsed && <p className="relative mt-auto px-6 text-xs text-slate-400">v1.0.0</p>}
    </motion.div>
    </>
  );
}
