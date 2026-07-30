import { useState } from 'react';
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
  X,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Dropdown, DropdownItem } from '../components';

const navigation = [
  { to: '/dashboard', label: 'ပင်မစာမျက်နှာ', icon: LayoutDashboard, superAdminOnly: true },
  { to: '/projects', label: 'ပရောဂျက်များ', icon: FolderOpen, superAdminOnly: true },
  { to: '/new-recap', label: 'Recap အသစ်', icon: Plus, userOnly: true },
  { to: '/history', label: 'မှတ်တမ်း', icon: Clock3 },
  { to: '/buy-credits', label: 'ခရက်ဒစ်', icon: Coins },
  { to: '/settings', label: 'ဆက်တင်များ', icon: Settings },
];

function Brand({ compact = false, logoOnly = false }: { compact?: boolean; logoOnly?: boolean }) {
  return (
    <div className="ds-brand">
      {logoOnly ? (
        <img className="ds-brand__logo" src="/assets/logo.svg" alt="TestRecap" />
      ) : (
        <span className="ds-brand__mark" aria-hidden="true">T</span>
      )}
      {!logoOnly && !compact && (
        <span className="ds-brand__copy">
          <strong>TestRecap</strong>
          <small>AI ရုပ်ရှင်စတူဒီယို</small>
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
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = profile?.role === 'super_admin';
  const availableNavigation = navigation.filter(item =>
    (!item.superAdminOnly || isSuperAdmin) && (!item.userOnly || !isSuperAdmin));
  const accountName = profile?.displayName || profile?.email || 'Google အကောင့်';
  const roleLabel = profile?.role === 'super_admin' ? 'စီမံခန့်ခွဲသူ' : 'အသုံးပြုသူ';
  const profileCredits = profile as (typeof profile & { creditBalance?: unknown; credits?: unknown });
  const rawCreditBalance = profileCredits?.creditBalance ?? profileCredits?.credits;
  const creditBalance = typeof rawCreditBalance === 'number' && Number.isFinite(rawCreditBalance)
    ? Math.max(0, rawCreditBalance)
    : 0;
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

      {isSuperAdmin && mobileOpen && (
        <div className="ds-mobile-drawer" role="dialog" aria-modal="true" aria-label="လမ်းညွှန်">
          <button className="ds-mobile-drawer__scrim" aria-label="လမ်းညွှန် ပိတ်မည်" onClick={() => setMobileOpen(false)} />
          <div className="ds-mobile-drawer__panel">
            <div className="ds-mobile-drawer__header">
              <Brand />
              <button className="ds-topbar__icon" onClick={() => setMobileOpen(false)} aria-label="လမ်းညွှန် ပိတ်မည်">
                <X size={20} />
              </button>
            </div>
            <Navigation items={availableNavigation} onNavigate={() => setMobileOpen(false)} />
            <div className="ds-mobile-account">
              <div className="ds-mobile-account__identity">
                <Avatar name={accountName} src={profile?.photoURL} size="sm" />
                <span>
                  <strong>{accountName}</strong>
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
            {isSuperAdmin && (
              <button className="ds-topbar__menu" onClick={() => setMobileOpen(true)} aria-label="လမ်းညွှန် ဖွင့်မည်">
                <Menu size={20} />
              </button>
            )}
            <div className="ds-topbar__mobile-brand"><Brand logoOnly={!isSuperAdmin} /></div>
            <span className="ds-topbar__eyebrow">ဖန်တီးမှု အလုပ်နေရာ</span>
          </div>
          <div className="ds-topbar__actions">
            <button
              className="ds-credit-indicator"
              onClick={() => navigate('/buy-credits')}
              aria-label={`ခရက်ဒစ် ${creditBalance}။ ခရက်ဒစ်စာမျက်နှာ ဖွင့်မည်`}
            >
              <Coins size={16} aria-hidden="true" />
              <strong>{creditBalance}</strong>
              <span>ခရက်ဒစ်</span>
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

      <nav className="ds-bottom-nav" aria-label="မိုဘိုင်း လမ်းညွှန်">
        {availableNavigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `ds-bottom-nav__item ${isActive ? 'ds-bottom-nav__item--active' : ''}`}
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
