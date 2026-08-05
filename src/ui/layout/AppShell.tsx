import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Clapperboard, ChevronDown, History as HistoryIcon, LogOut, Settings as SettingsIcon, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../components';

// Premium-SaaS refinement pass: the original reference (BlinkAutomationFull_v2.jsx)
// used plain text labels with no icons anywhere. Real mobile SaaS navigation
// (this brief's explicit ask) needs a consistent icon per destination, so
// lucide-react (already a dependency, already used by VideoEffectsEditor) is
// used here as the one icon set for nav + header + account menu.
const navigation = [
  { to: '/new-recap', label: 'New Recap', Icon: Clapperboard },
  { to: '/history', label: 'History', Icon: HistoryIcon },
  { to: '/buy-credits', label: 'Plans & Credits', Icon: Wallet },
  { to: '/admin', label: 'Super Admin', superAdminOnly: true, Icon: ShieldCheck },
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

function Brand() {
  return (
    <div className="brand"><span className="mark" />Blink</div>
  );
}

// Reference (BlinkAutomationFull_v2.jsx) drives its sidebar/mobileNav with
// plain <button onClick={...}> state switches. Real navigation needs actual
// URLs (deep-linking, protected routes, browser back/forward), so this uses
// react-router NavLink instead — the one necessary architectural adaptation
// called out in the approved migration plan. It renders an <a>, so app.css
// adds ".sidenav a"/".mobileNav a" alongside the reference's own
// ".sidenav button"/".mobileNav button" rules (additive, not a rewrite of
// the verbatim block).
function Navigation({ items }: { items: typeof navigation }) {
  return (
    <nav className="sidenav" aria-label="အဓိက လမ်းညွှန်">
      {items.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon size={18} aria-hidden="true" /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// Replaces the two standing "Settings"/"Logout" text buttons the brief
// flagged as header clutter with a single icon-triggered account panel — an
// inline, locally-owned expand-in-place panel (the same pattern already
// used by BuyCreditsPage/SuperAdminPage for their non-modal flows), not a
// reusable overlay abstraction reintroduced into the shared component set.
function AccountMenu({
  accountName,
  photoURL,
  onOpenSettings,
  onSignOut,
  signingOut,
  signOutError,
  upward = false,
}: {
  accountName: string;
  photoURL?: string | null;
  onOpenSettings: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: boolean;
  upward?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`accountMenu${upward ? ' accountMenu--upward' : ''}`} ref={containerRef}>
      <button
        type="button"
        className="accountMenu__trigger"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${accountName} အကောင့် မီနူး`}
      >
        <Avatar name={accountName} src={photoURL ?? undefined} size="sm" />
        <ChevronDown size={16} aria-hidden="true" className={open ? 'accountMenu__chevron accountMenu__chevron--open' : 'accountMenu__chevron'} />
      </button>
      <div className={`accountMenu__panel${open ? ' is-open' : ''}`} role="menu" aria-hidden={!open}>
        <div className="accountMenu__identity">{accountName}</div>
        <button type="button" role="menuitem" tabIndex={open ? 0 : -1} className="accountMenu__item" onClick={() => { setOpen(false); onOpenSettings(); }}>
          <SettingsIcon size={18} aria-hidden="true" /> ဆက်တင်များ
        </button>
        <button
          type="button"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          className="accountMenu__item accountMenu__item--danger"
          onClick={() => { setOpen(false); onSignOut(); }}
          disabled={signingOut}
        >
          <LogOut size={18} aria-hidden="true" /> {signingOut ? 'ထွက်နေသည်…' : 'အကောင့်မှ ထွက်မည်'}
        </button>
        {signOutError && <small className="hint" role="alert" style={{ color: 'var(--danger)' }}>အကောင့်မှ ထွက်၍မရပါ။ ထပ်ကြိုးစားပါ။</small>}
      </div>
    </div>
  );
}

export function AppShell() {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary>({ credits: null, plan: null });
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdmin = profile?.role === 'super_admin';
  const availableNavigation = navigation.filter(item => !item.superAdminOnly || isSuperAdmin);
  const accountName = profile?.displayName || profile?.email || 'Google အကောင့်';

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

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await logout();
      navigate('/', { replace: true });
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };

  return (
    <div className="workspaceApp">
      <a href="#main-content" className="skip-link">အဓိကအကြောင်းအရာသို့ သွားမည်</a>

      <aside className="sidebar" aria-label="အလုပ်နေရာ ဘေးဘား">
        <div className="sidebrand"><Brand /></div>
        <Navigation items={availableNavigation} />
        <div className="sidebottom">
          <div className="creditbox">
            <small className="muted">လက်ကျန် Credits</small>
            <div className="row between" style={{ marginTop: 4 }}>
              <b>{billingSummary.credits ?? '—'}</b>
              <span className="chip">{billingSummary.plan ?? 'No plan'}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <AccountMenu
              accountName={accountName}
              photoURL={profile?.photoURL}
              onOpenSettings={() => navigate('/settings')}
              onSignOut={() => void signOut()}
              signingOut={signingOut}
              signOutError={signOutError}
              upward
            />
          </div>
        </div>
      </aside>

      <div className="mainarea">
        <header className="appheader">
          <Brand />
          <div className="row">
            <button className="chip" onClick={() => navigate('/buy-credits')} style={{ cursor: 'pointer' }}>
              {billingSummary.credits ?? '—'} Credits
            </button>
            <AccountMenu
              accountName={accountName}
              photoURL={profile?.photoURL}
              onOpenSettings={() => navigate('/settings')}
              onSignOut={() => void signOut()}
              signingOut={signingOut}
              signOutError={signOutError}
            />
          </div>
        </header>

        <main id="main-content" className="apppage" tabIndex={-1}>
          <div key={location.pathname} className="routeFade">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="mobileNav" aria-label="အဓိက လမ်းညွှန်">
        {availableNavigation.filter(item => item.to !== '/admin').map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={22} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
        {isSuperAdmin && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
            <ShieldCheck size={22} aria-hidden="true" /><span>Admin</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
