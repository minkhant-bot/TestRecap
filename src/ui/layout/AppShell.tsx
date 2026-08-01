import { useEffect, useRef, useState } from 'react';
import {
  Clock3,
  Coins,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Dropdown, DropdownItem } from '../components';

const navigation = [
  { to: '/dashboard', label: 'ပင်မစာမျက်နှာ', icon: LayoutDashboard, superAdminOnly: true },
  { to: '/projects', label: 'ပရောဂျက်များ', icon: FolderOpen, superAdminOnly: true },
  { to: '/admin', label: 'Super Admin', icon: ShieldCheck, superAdminOnly: true },
  { to: '/new-recap', label: 'Recap အသစ်', icon: Plus, userOnly: true },
  { to: '/history', label: 'မှတ်တမ်း', icon: Clock3 },
  { to: '/buy-credits', label: 'ခရက်ဒစ်', icon: Coins },
  { to: '/settings', label: 'ဆက်တင်များ', icon: Settings },
];

interface BillingSummary {
  credits: string | null;
  plan: string | null;
}

const formatCreditBalance = (value: unknown) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value.toLocaleString();
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value).toLocaleString();
  }
  return null;
};

function Brand({ compact = false, logoOnly = false }: { compact?: boolean; logoOnly?: boolean }) {
  return (
    <div className="ds-brand">
      {logoOnly ? (
        <img className="ds-brand__logo" src="/assets/logo.svg" alt="Blink Automation" />
      ) : (
        <span className="ds-brand__mark" aria-hidden="true">B</span>
      )}
      {!logoOnly && !compact && (
        <span className="ds-brand__copy">
          <strong>Blink</strong>
          <small>Automation Studio</small>
        </span>
      )}
    </div>
  );
}

function Navigation({ items, onNavigate }: { items: typeof navigation; onNavigate?: () => void }) {
  return (
    <nav className="ds-nav" aria-label="အဓိက လမ်းညွှန်">
      <span className="ds-nav__label">အလုပ်နေရာ</span>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `ds-nav__item ${isActive ? 'ds-nav__item--active' : ''}`}
          onClick={onNavigate}
        >
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const [tabletCollapsed, setTabletCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary>({ credits: null, plan: null });
  const mobileMenuTrigger = useRef<HTMLButtonElement>(null);
  const mobileMenuClose = useRef<HTMLButtonElement>(null);
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = profile?.role === 'super_admin';
  const availableNavigation = navigation.filter(item =>
    (!item.superAdminOnly || isSuperAdmin) && (!item.userOnly || !isSuperAdmin));
  const accountName = profile?.displayName || profile?.email || 'Google အကောင့်';
  const roleLabel = profile?.role === 'super_admin'
    ? 'Owner / Super Admin'
    : profile?.role === 'admin' ? 'Admin' : 'အသုံးပြုသူ';

  useEffect(() => {
    let active = true;
    setBillingSummary({ credits: null, plan: null });
    const loadBillingSummary = async () => {
      const [balanceResponse, planResponse] = await Promise.all([
        fetch('/api/credits/balance', { credentials: 'include' }),
        fetch('/api/plans/me', { credentials: 'include' }),
      ]);
      if (!active || !balanceResponse.ok || !planResponse.ok) return;
      const [balance, plan] = await Promise.all([balanceResponse.json(), planResponse.json()]);
      if (!active) return;
      setBillingSummary({
        credits: formatCreditBalance(balance?.availableBalance),
        plan: typeof plan?.planName === 'string' && plan.planName.trim() ? plan.planName.trim() : null,
      });
    };
    void loadBillingSummary().catch(() => undefined);
    return () => { active = false; };
  }, [profile?.uid]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => mobileMenuClose.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      mobileMenuTrigger.current?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 767px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileOpen(false);
    };
    mobileViewport.addEventListener('change', closeOnDesktop);
    return () => mobileViewport.removeEventListener('change', closeOnDesktop);
  }, []);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };

  return (
    <div className={`ds-app-shell ${tabletCollapsed ? 'ds-app-shell--collapsed' : ''}`}>
      <a href="#main-content" className="ds-skip-link">အဓိကအကြောင်းအရာသို့ သွားမည်</a>

      <aside className="ds-sidebar" aria-label="အလုပ်နေရာ ဘေးဘား">
        <div className="ds-sidebar__header">
          <Brand compact={tabletCollapsed} logoOnly={!isSuperAdmin} />
          <button
            className="ds-sidebar__collapse"
            onClick={() => setTabletCollapsed((value) => !value)}
            aria-label={tabletCollapsed ? 'ဘေးဘားကို ဖြန့်မည်' : 'ဘေးဘားကို ချုံ့မည်'}
          >
            {tabletCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <Navigation items={availableNavigation} />
        <div className="ds-sidebar__footer">
          <Dropdown
            align="start"
            trigger={({ open, onClick, ...aria }) => (
              <button
                className="ds-sidebar__account"
                aria-label="အကောင့်မီနူး ဖွင့်မည်"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={onClick}
                {...aria}
              >
                <Avatar name={accountName} src={profile?.photoURL} size="sm" />
                {!tabletCollapsed && (
                  <span>
                    <strong>{accountName}</strong>
                    <small>{roleLabel}</small>
                  </span>
                )}
              </button>
            )}
          >
            <DropdownItem onSelect={() => void signOut()}>
              <span>{signingOut ? 'ထွက်နေသည်…' : 'အကောင့်မှ ထွက်မည်'}</span>
              <LogOut size={16} aria-hidden="true" />
            </DropdownItem>
            {signOutError && <span className="ds-account-error" role="alert">အကောင့်မှ ထွက်၍မရပါ။ ထပ်ကြိုးစားပါ။</span>}
          </Dropdown>
        </div>
      </aside>

      {mobileOpen && (
        <div className="ds-mobile-drawer" role="dialog" aria-modal="true" aria-label="လမ်းညွှန်">
          <button className="ds-mobile-drawer__scrim" aria-label="လမ်းညွှန် ပိတ်မည်" onClick={() => setMobileOpen(false)} />
          <div className="ds-mobile-drawer__panel">
            <div className="ds-mobile-drawer__header">
              <div>
                <Brand />
                {isSuperAdmin && <span className="ds-mobile-drawer__role">Owner / Super Admin</span>}
              </div>
              <button ref={mobileMenuClose} className="ds-topbar__icon" onClick={() => setMobileOpen(false)} aria-label="လမ်းညွှန် ပိတ်မည်">
                <X size={20} />
              </button>
            </div>
            <Navigation items={availableNavigation} onNavigate={() => setMobileOpen(false)} />
            <div className="ds-mobile-account">
              <button className="ds-mobile-billing" onClick={() => { setMobileOpen(false); navigate('/buy-credits'); }}>
                <span>
                  <small>ခရက်ဒစ်</small>
                  <strong>{billingSummary.credits ?? '—'}</strong>
                </span>
                <span>
                  <small>အစီအစဉ်</small>
                  <strong>{billingSummary.plan ?? 'မဖွင့်ရသေး'}</strong>
                </span>
              </button>
              <div className="ds-mobile-account__identity">
                <Avatar name={accountName} src={profile?.photoURL} size="sm" />
                <span>
                  <strong>{accountName}</strong>
                  <small>{profile?.email}</small>
                  <small>{roleLabel}</small>
                </span>
              </div>
              <Button
                variant="secondary"
                icon={<LogOut size={17} />}
                loading={signingOut}
                onClick={() => void signOut()}
              >
                အကောင့်မှ ထွက်မည်
              </Button>
              {signOutError && <span className="ds-account-error" role="alert">အကောင့်မှ ထွက်၍မရပါ။ ထပ်ကြိုးစားပါ။</span>}
            </div>
          </div>
        </div>
      )}

      <div className="ds-app-frame">
        <header className="ds-topbar">
          <div className="ds-topbar__start">
            <button ref={mobileMenuTrigger} className="ds-topbar__menu" onClick={() => setMobileOpen(true)} aria-label="လမ်းညွှန် ဖွင့်မည်">
              <Menu size={20} />
            </button>
            <div className="ds-topbar__mobile-brand"><Brand /></div>
            <span className="ds-topbar__eyebrow">ဖန်တီးမှု အလုပ်နေရာ</span>
          </div>
          <div className="ds-topbar__actions">
            <button
              className="ds-credit-indicator"
              onClick={() => navigate('/buy-credits')}
              aria-label={`ခရက်ဒစ် ${billingSummary.credits ?? 'မရရှိနိုင်'}။ ခရက်ဒစ်စာမျက်နှာ ဖွင့်မည်`}
            >
              <Coins size={16} aria-hidden="true" />
              <strong>{billingSummary.credits ?? '—'}</strong>
              <span>ခရက်ဒစ်</span>
            </button>
            <button className="ds-topbar__mobile-avatar" onClick={() => setMobileOpen(true)} aria-label="အကောင့်နှင့် လမ်းညွှန်မီနူး ဖွင့်မည်">
              <Avatar name={accountName} src={profile?.photoURL} size="sm" />
            </button>
            <Dropdown
              trigger={({ open, onClick, ...aria }) => (
                <button
                  className="ds-avatar-action"
                  aria-label="အကောင့်မီနူး ဖွင့်မည်"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={onClick}
                  {...aria}
                >
                  <Avatar name={accountName} src={profile?.photoURL} size="sm" />
                </button>
              )}
            >
              <DropdownItem onSelect={() => void signOut()}>
                <span>{signingOut ? 'ထွက်နေသည်…' : 'အကောင့်မှ ထွက်မည်'}</span>
                <LogOut size={16} aria-hidden="true" />
              </DropdownItem>
              {signOutError && <span className="ds-account-error" role="alert">အကောင့်မှ ထွက်၍မရပါ။ ထပ်ကြိုးစားပါ။</span>}
            </Dropdown>
          </div>
        </header>

        <main id="main-content" className="ds-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

    </div>
  );
}
