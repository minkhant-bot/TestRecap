import { useEffect, useState } from "react";
import {
  Film, Upload, CheckCircle2, XCircle, Clock, Loader2, Users, ShieldCheck,
  CreditCard, History, LayoutDashboard, LogOut, AlertTriangle, Ban,
  Landmark, FileClock, ChevronRight, ChevronDown, Play, RotateCcw, Download,
  X, Wallet, ReceiptText, Gauge, Lock, Sparkles, CircleDot,
  Eye, KeyRound, ServerCog, ListChecks, Settings2, Plus, Minus, Pencil,
  ArrowUp, ArrowDown, Archive, PowerOff, Power, Paperclip, Settings,
  Package, Menu,
} from "lucide-react";

/* =========================================================================
   BLINK AUTOMATION — UI PREVIEW
   Design tokens: graphite-navy base, projector-amber primary action,
   signal-violet AI/processing accent. Display: Space Grotesk. Body: Inter.
   Data: IBM Plex Mono. Signature element: "filmstrip" pipeline stepper.
   ========================================================================= */

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');";

const CSS = `
${FONT_IMPORT}
:root{
  --bg:#0B0D12;
  --bg-soft:#0F1218;
  --surface:#141821;
  --surface-2:#1B202B;
  --surface-3:#232938;
  --border:#252B3A;
  --border-soft:#1D2330;
  --text:#EEF0F5;
  --text-dim:#9199AF;
  --text-faint:#5B6274;
  --amber:#E7A73B;
  --amber-ink:#231604;
  --violet:#8B7CF6;
  --success:#34D399;
  --danger:#F1596C;
  --danger-soft:#3A1E26;
  --focus:#8FB4FF;
}
.blink-root{ background:var(--bg); color:var(--text); font-family:'Inter',ui-sans-serif,system-ui,sans-serif; min-height:100%; width:100%; }
.blink-root *{ box-sizing:border-box; }
.blink-display{ font-family:'Space Grotesk','Inter',sans-serif; letter-spacing:-0.01em; }
.blink-mono{ font-family:'IBM Plex Mono',monospace; }
.blink-root ::-webkit-scrollbar{ width:8px; height:8px; }
.blink-root ::-webkit-scrollbar-thumb{ background:var(--border); border-radius:8px; }
.blink-root ::-webkit-scrollbar-track{ background:transparent; }
.blink-focus:focus-visible{ outline:2px solid var(--focus); outline-offset:2px; border-radius:8px; }
@media (prefers-reduced-motion: reduce){ .blink-root *{ animation-duration:0.001ms !important; transition-duration:0.001ms !important; } }

.filmstrip{ position:relative; border-top:1px dashed var(--border); border-bottom:1px dashed var(--border); padding:14px 4px; }
.filmstrip::before, .filmstrip::after{ content:""; position:absolute; left:0; right:0; height:9px; background-image:repeating-linear-gradient(to right, var(--bg-soft) 0 6px, transparent 6px 14px); background-position:center; }
.filmstrip::before{ top:-5px; }
.filmstrip::after{ bottom:-5px; }
.filmstrip-track{ position:relative; }
.filmstrip-rail{ position:absolute; top:15px; left:15px; right:15px; height:2px; background:var(--border); }
.filmstrip-rail-fill{ position:absolute; top:0; left:0; height:2px; background:linear-gradient(90deg, var(--violet), var(--amber)); transition:width .5s ease; }

.spin-slow{ animation:spin 1.4s linear infinite; }
@keyframes spin{ to{ transform:rotate(360deg); } }

.chip{ display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; line-height:1; border:1px solid var(--border); white-space:nowrap; }
.gated-chip{ border:1px dashed var(--text-faint); color:var(--text-dim); background:transparent; }
.card{ background:var(--surface); border:1px solid var(--border); border-radius:16px; }
`;

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const WORKFLOW_STEPS = [
  { id: "upload", label: "Upload" },
  { id: "audio_extraction", label: "Audio Extraction" },
  { id: "gemini_transcript", label: "Gemini Transcript" },
  { id: "voice_generation", label: "Voice Generation" },
  { id: "timeline_verification", label: "Timeline Verification" },
  { id: "scene_rebuild", label: "Scene Rebuild" },
  { id: "final_export", label: "Final Export" },
];

const PLAN_TABLE = [
  { plan: "Trial", credential: "Your own Gemini key (BYOK)", credits: "Free allowance, then requires purchased credits", effects: "Not available", purpose: "Limited trial to try Blink" },
  { plan: "Normal", credential: "Your own Gemini key (BYOK)", credits: "Purchased credits, standard rate", effects: "Not available", purpose: "Paid Blink infrastructure, you cover Gemini" },
  { plan: "Pro", credential: "Blink-provided", credits: "Purchased credits, higher rate", effects: "Available", purpose: "Fully provider-funded, full feature set" },
];

const MOCK_USER = { name: "Thiri Kyaw", email: "thiri.kyaw@example.com", role: "user", plan: "Normal", credits: 128 };
const MOCK_ADMIN = { name: "Min", email: "min85639@gmail.com", role: "super_admin", plan: "Pro", credits: 940 };

const HISTORY_JOBS = [
  { id: "job_8841", title: "Action Movie Recap — Ep 04", status: "completed", stage: "final_export", duration: "8:42", credits: 18, updated: "Today, 10:12" },
  { id: "job_8837", title: "K-Drama Recap — Ep 12", status: "processing", stage: "scene_rebuild", duration: "6:05", credits: 13, updated: "Today, 09:40" },
  { id: "job_8830", title: "Thriller Recap — Pilot", status: "failed", stage: "gemini_transcript", duration: "—", credits: 0, updated: "Yesterday, 22:03" },
  { id: "job_8825", title: "Romance Recap — Ep 03", status: "completed", stage: "final_export", duration: "9:41", credits: 20, updated: "Yesterday, 18:55" },
  { id: "job_8819", title: "Sci-Fi Recap — Ep 01", status: "cancelled", stage: "audio_extraction", duration: "—", credits: 0, updated: "2 days ago" },
  { id: "job_8802", title: "Horror Recap — Special", status: "queued", stage: "upload", duration: "5:30", credits: 12, updated: "2 days ago" },
];

const ADMIN_USERS = [
  { id: "u_01", name: "Thiri Kyaw", email: "thiri.kyaw@example.com", role: "user", plan: "Normal", credits: 128, status: "active", joined: "2026-03-14" },
  { id: "u_02", name: "Zayar Lin", email: "zayar.lin@example.com", role: "user", plan: "Trial", credits: 6, status: "active", joined: "2026-05-02" },
  { id: "u_03", name: "Hnin Wai", email: "hnin.wai@example.com", role: "admin", plan: "Pro", credits: 402, status: "active", joined: "2025-11-20" },
  { id: "u_04", name: "Kaung Htet", email: "kaung.htet@example.com", role: "user", plan: "Normal", credits: 0, status: "disabled", joined: "2026-01-09" },
  { id: "u_05", name: "Min", email: "min85639@gmail.com", role: "super_admin", plan: "Pro", credits: 940, status: "active", joined: "2025-08-01" },
];

const INITIAL_PURCHASES = [
  { id: "p_501", user: "Zayar Lin", packageName: "Starter", credits: 500, amount: "50,000 MMK", bank: "KBZ Pay — Blink Studio", proof: "payment_501.jpg", status: "awaiting_review", submitted: "Today, 11:02" },
  { id: "p_498", user: "Thiri Kyaw", packageName: "Creator", credits: 1200, amount: "110,000 MMK", bank: "AYA Bank — Blink Studio", proof: "payment_498.jpg", status: "awaiting_review", submitted: "Today, 08:47" },
  { id: "p_492", user: "Hnin Wai", packageName: "Studio", credits: 3000, amount: "250,000 MMK", bank: "Wave Pay — Blink Studio", proof: "payment_492.jpg", status: "credits_added", submitted: "Yesterday", addedAt: "Yesterday, 14:20" },
];

const ADMIN_BANKS = [
  { id: "b_1", name: "KBZ Pay — Blink Studio", account: "•••• 4471", currency: "MMK" },
  { id: "b_2", name: "AYA Bank — Blink Studio", account: "•••• 0932", currency: "MMK" },
  { id: "b_3", name: "Wave Pay — Blink Studio", account: "•••• 7710", currency: "MMK" },
];

const ADMIN_RATES = [
  { plan: "Trial", rate: "1 credit / 30s block (free allowance)" },
  { plan: "Normal", rate: "2 credits / 30s block" },
  { plan: "Pro", rate: "3 credits / 30s block" },
];

const INITIAL_AUDIT_LOG = [
  { id: "a_1", actor: "min85639@gmail.com", action: "Added 3,000 credits to Hnin Wai for purchase p_492 (bank-verified manually)", time: "Yesterday, 14:20" },
  { id: "a_3", actor: "hnin.wai@example.com (admin)", action: "Viewed system status", time: "3 days ago" },
  { id: "a_4", actor: "min85639@gmail.com", action: "Added +50 credits to Zayar Lin — reason: support goodwill", time: "5 days ago" },
];

const CREDIT_LEDGER = [
  { id: "l_1", label: "Recap job — Action Movie Recap Ep 04", delta: -18, time: "Today, 10:12" },
  { id: "l_2", label: "Manual credit — Starter package verified", delta: 500, time: "Jul 22" },
  { id: "l_3", label: "Recap job — Romance Recap Ep 03", delta: -20, time: "Jul 20" },
  { id: "l_4", label: "First purchase bonus", delta: 50, time: "Jul 02" },
];

const INITIAL_PACKAGES = [
  { id: "pkg_1", name: "Starter", credits: 500, price: "50,000 MMK", status: "active" },
  { id: "pkg_2", name: "Creator", credits: 1200, price: "110,000 MMK", status: "active" },
  { id: "pkg_3", name: "Studio", credits: 3000, price: "250,000 MMK", status: "active" },
  { id: "pkg_4", name: "Legacy Bulk", credits: 10000, price: "800,000 MMK", status: "inactive" },
  { id: "pkg_5", name: "Launch Promo", credits: 800, price: "60,000 MMK", status: "archived" },
];

/* ------------------------------------------------------------------ */
/* Small primitives                                                    */
/* ------------------------------------------------------------------ */

function Chip({ tone = "neutral", children, dashed = false, icon }) {
  const tones = {
    neutral: { border: "var(--border)", color: "var(--text-dim)", bg: "transparent" },
    success: { border: "rgba(52,211,153,0.35)", color: "var(--success)", bg: "rgba(52,211,153,0.08)" },
    danger: { border: "rgba(241,89,108,0.35)", color: "var(--danger)", bg: "rgba(241,89,108,0.08)" },
    violet: { border: "rgba(139,124,246,0.35)", color: "var(--violet)", bg: "rgba(139,124,246,0.08)" },
    amber: { border: "rgba(231,167,59,0.4)", color: "var(--amber)", bg: "rgba(231,167,59,0.08)" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span className="chip" style={{ borderColor: t.border, color: t.color, background: t.bg, borderStyle: dashed ? "dashed" : "solid" }}>
      {icon}{children}
    </span>
  );
}

function GatedNote({ children }) {
  return (
    <div className="chip gated-chip" style={{ borderRadius: 10, padding: "8px 12px", gap: 8, fontSize: 12.5, fontWeight: 500 }}>
      <Lock size={13} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

function Button({ variant = "primary", size = "md", icon, children, className = "", ...props }) {
  const base = "blink-focus inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "text-xs px-3 py-1.5", md: "text-sm px-4 py-2.5", lg: "text-sm px-5 py-3" };
  const styles = {
    primary: { background: "var(--amber)", color: "var(--amber-ink)", border: "1px solid transparent" },
    secondary: { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" },
    ghost: { background: "transparent", color: "var(--text-dim)", border: "1px solid transparent" },
    danger: { background: "rgba(241,89,108,0.12)", color: "var(--danger)", border: "1px solid rgba(241,89,108,0.35)" },
  };
  return (
    <button className={`${base} ${sizes[size]} ${className}`} style={styles[variant]} {...props}>
      {icon}{children}
    </button>
  );
}

function SectionHeading({ eyebrow, title, desc, right }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
      <div>
        {eyebrow && <div className="text-xs font-semibold mb-1" style={{ color: "var(--violet)", letterSpacing: "0.06em" }}>{eyebrow.toUpperCase()}</div>}
        <h2 className="blink-display text-xl font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
        {desc && <p className="text-sm mt-1" style={{ color: "var(--text-dim)", maxWidth: 560 }}>{desc}</p>}
      </div>
      {right}
    </div>
  );
}

function statusChip(status) {
  switch (status) {
    case "completed": return <Chip tone="success" icon={<CheckCircle2 size={12} />}>Completed</Chip>;
    case "processing": return <Chip tone="violet" icon={<Loader2 size={12} className="spin-slow" />}>Processing</Chip>;
    case "queued": return <Chip tone="neutral" icon={<Clock size={12} />}>Waiting</Chip>;
    case "failed": return <Chip tone="danger" icon={<XCircle size={12} />}>Failed</Chip>;
    case "cancelled": return <Chip tone="neutral" icon={<X size={12} />}>Cancelled</Chip>;
    case "awaiting_review": return <Chip tone="amber" icon={<Clock size={12} />}>Awaiting manual check</Chip>;
    case "credits_added": return <Chip tone="success" icon={<CheckCircle2 size={12} />}>Credits added</Chip>;
    case "active": return <Chip tone="success">Active</Chip>;
    case "inactive": return <Chip tone="neutral">Inactive</Chip>;
    case "archived": return <Chip tone="neutral" dashed>Archived</Chip>;
    default: return <Chip tone="neutral">{status}</Chip>;
  }
}

/* ------------------------------------------------------------------ */
/* App shell: sidebar + bottom nav (real product navigation)           */
/* ------------------------------------------------------------------ */

function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="blink-focus w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
      style={{ background: active ? "var(--surface-3)" : "transparent", color: active ? "var(--text)" : "var(--text-dim)", border: active ? "1px solid var(--border)" : "1px solid transparent" }}
    >
      <span style={{ color: active ? "var(--amber)" : "var(--text-faint)" }}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && <ChevronRight size={14} style={{ color: "var(--text-faint)" }} />}
    </button>
  );
}

function Sidebar({ screen, setScreen, role, user, onLogout }) {
  const items = [
    ...(role === "super_admin" ? [{ id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> }] : []),
    { id: "newrecap", label: "New Recap", icon: <Film size={17} /> },
    { id: "history", label: "History", icon: <History size={17} /> },
    { id: "plans", label: "Plans & Credits", icon: <CreditCard size={17} /> },
    ...(role === "super_admin" ? [{ id: "admin", label: "Super Admin", icon: <ShieldCheck size={17} /> }] : []),
  ];
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 p-4 gap-1" style={{ borderRight: "1px solid var(--border)", background: "var(--bg-soft)" }}>
      <div className="flex items-center gap-2 px-2 py-3 mb-2">
        <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "var(--amber)", color: "var(--amber-ink)" }}>
          <Film size={17} />
        </div>
        <div>
          <div className="blink-display text-sm font-semibold leading-none">Blink</div>
          <div className="text-[11px] leading-none mt-1" style={{ color: "var(--text-faint)" }}>Automation Studio</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <NavItem key={it.id} icon={it.icon} label={it.label} active={screen === it.id} onClick={() => setScreen(it.id)} />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}><Wallet size={13} />Credits</div>
        <div className="blink-mono text-lg font-medium mt-1">{user.credits.toLocaleString()}</div>
        <Chip tone="amber">{user.plan} plan</Chip>
      </div>

      <button onClick={onLogout} className="blink-focus flex items-center gap-2 mt-3 px-2 py-2 rounded-lg text-left" style={{ background: "transparent" }}>
        <div className="rounded-full flex items-center justify-center text-xs font-semibold" style={{ width: 28, height: 28, background: "var(--surface-3)", color: "var(--text)" }}>
          {user.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{user.name}</div>
          <div className="text-[11px] truncate" style={{ color: "var(--text-faint)" }}>{user.email}</div>
        </div>
        <LogOut size={14} style={{ color: "var(--text-faint)" }} />
      </button>
    </aside>
  );
}

function MobileHeader({ onOpen, user }) {
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3"
      style={{ background: "rgba(15,18,24,0.96)", borderBottom: "1px solid var(--border)", backdropFilter: "blur(14px)" }}
    >
      <button
        onClick={onOpen}
        className="blink-focus rounded-xl flex items-center justify-center"
        style={{ width: 40, height: 40, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        aria-label="Open navigation menu"
      >
        <Menu size={20} />
      </button>

      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--amber)", color: "var(--amber-ink)" }}>
          <Film size={16} />
        </div>
        <div>
          <div className="blink-display text-sm font-semibold leading-none">Blink</div>
          <div className="text-[10px] leading-none mt-1" style={{ color: "var(--text-faint)" }}>Automation Studio</div>
        </div>
      </div>

      <div className="rounded-full flex items-center justify-center text-xs font-semibold" style={{ width: 36, height: 36, background: "var(--surface-3)", border: "1px solid var(--border)" }}>
        {user.name[0]}
      </div>
    </header>
  );
}

function MobileDrawer({ open, onClose, screen, setScreen, role, user, onLogout }) {
  const items = [
    ...(role === "super_admin" ? [{ id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> }] : []),
    { id: "newrecap", label: "New Recap", icon: <Film size={18} /> },
    { id: "history", label: "History", icon: <History size={18} /> },
    { id: "plans", label: "Plans & Credits", icon: <CreditCard size={18} /> },
    ...(role === "super_admin" ? [{ id: "admin", label: "Super Admin", icon: <ShieldCheck size={18} /> }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const navigate = (id) => {
    setScreen(id);
    onClose();
  };

  return (
    <div className="md:hidden fixed inset-0 z-50">
      <button
        className="absolute inset-0 w-full h-full"
        style={{ background: "rgba(0,0,0,0.62)", backdropFilter: "blur(3px)" }}
        onClick={onClose}
        aria-label="Close navigation menu"
      />

      <aside
        className="absolute inset-y-0 left-0 flex flex-col p-4 gap-1 overflow-y-auto"
        style={{ width: "min(86vw, 330px)", background: "var(--bg-soft)", borderRight: "1px solid var(--border)", boxShadow: "18px 0 45px rgba(0,0,0,0.35)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex items-center justify-between px-2 py-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "var(--amber)", color: "var(--amber-ink)" }}>
              <Film size={17} />
            </div>
            <div>
              <div className="blink-display text-sm font-semibold leading-none">Blink</div>
              <div className="text-[11px] leading-none mt-1" style={{ color: "var(--text-faint)" }}>Automation Studio</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="blink-focus rounded-xl flex items-center justify-center"
            style={{ width: 38, height: 38, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
            aria-label="Close navigation menu"
          >
            <X size={19} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((it) => (
            <NavItem key={it.id} icon={it.icon} label={it.label} active={screen === it.id} onClick={() => navigate(it.id)} />
          ))}
        </nav>

        <div className="flex-1 min-h-6" />

        <div className="rounded-xl p-3 mb-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}><Wallet size={13} />Credits</div>
              <div className="blink-mono text-lg font-medium mt-1">{user.credits.toLocaleString()}</div>
            </div>
            <Chip tone="amber">{user.plan} plan</Chip>
          </div>
        </div>

        <button
          onClick={() => { onClose(); onLogout(); }}
          className="blink-focus flex items-center gap-3 px-3 py-3 rounded-xl text-left"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="rounded-full flex items-center justify-center text-xs font-semibold" style={{ width: 34, height: 34, background: "var(--surface-3)", color: "var(--text)" }}>
            {user.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user.name}</div>
            <div className="text-[11px] truncate" style={{ color: "var(--text-faint)" }}>{user.email}</div>
          </div>
          <LogOut size={15} style={{ color: "var(--text-faint)" }} />
        </button>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: Login                                                        */
/* ------------------------------------------------------------------ */

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.41 13.94A6.03 6.03 0 0 1 6.1 12c0-.67.12-1.32.31-1.94V7.44H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.56l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.44l3.35 2.62C7.2 7.7 9.4 5.94 12 5.94Z" />
    </svg>
  );
}

function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="min-h-full w-full flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="grid md:grid-cols-2 w-full max-w-4xl rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="p-8 md:p-10 flex flex-col justify-between gap-8" style={{ background: "linear-gradient(160deg, var(--surface-2), var(--bg-soft))" }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--amber)", color: "var(--amber-ink)" }}>
              <Film size={16} />
            </div>
            <span className="blink-display font-semibold text-sm">Blink Automation</span>
          </div>
          <div>
            <Chip tone="violet" icon={<Sparkles size={12} />}>AI recap studio</Chip>
            <h1 className="blink-display text-2xl md:text-3xl font-semibold mt-4 leading-tight">
              Burmese-narrated movie recaps, generated end to end.
            </h1>
            <p className="text-sm mt-3" style={{ color: "var(--text-dim)" }}>
              မြန်မာဘာသာဖြင့် AI ရုပ်ရှင် Recap များ။ Upload a source video and Blink handles transcription, translation, voice, timeline, and export.
            </p>
          </div>
          <div className="text-xs" style={{ color: "var(--text-faint)" }}>Private workspace · secure server session</div>
        </div>

        <div className="p-8 md:p-10 flex flex-col justify-center gap-5" style={{ background: "var(--surface)" }}>
          <div className="flex items-center gap-2" style={{ color: "var(--text-dim)" }}>
            <ShieldCheck size={16} />
            <span className="text-xs font-medium">Secure sign-in</span>
          </div>
          <h2 className="blink-display text-lg font-semibold">Welcome to Blink</h2>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>Blink uses Google sign-in only. There's no separate password to manage.</p>
          <Button
            variant="secondary" size="lg" icon={<GoogleMark />} className="w-full"
            onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); onLogin(); }, 700); }}
          >
            {loading ? "Signing in…" : "Continue with Google"}
          </Button>
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>This is a design preview — no real authentication occurs here.</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: Dashboard (super admin home) — no system health here         */
/* ------------------------------------------------------------------ */

function StatCard({ icon, label, value, note }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span style={{ color: "var(--text-faint)" }}>{icon}</span>
        {note}
      </div>
      <div className="blink-mono text-2xl font-medium">{value}</div>
      <div className="text-xs" style={{ color: "var(--text-dim)" }}>{label}</div>
    </div>
  );
}

function DashboardScreen({ setScreen, purchases }) {
  const awaiting = purchases.filter((p) => p.status === "awaiting_review").length;
  return (
    <div className="p-5 md:p-8 max-w-5xl mx-auto w-full">
      <SectionHeading
        eyebrow="Overview"
        title="Dashboard"
        desc="A quick operational snapshot for Admin and Super Admin. Detailed system health lives under Super Admin → System Status."
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <StatCard icon={<Gauge size={16} />} value="1" label="Active job (of 2 max/user)" />
        <StatCard icon={<Users size={16} />} value={ADMIN_USERS.length} label="Registered users" />
        <StatCard icon={<FileClock size={16} />} value={awaiting} label="Purchase requests awaiting manual credit" note={awaiting > 0 ? <Chip tone="amber">Action needed</Chip> : null} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Recent workspace jobs</h3>
          <button className="text-xs font-medium blink-focus" style={{ color: "var(--violet)" }} onClick={() => setScreen("history")}>View history</button>
        </div>
        <div className="flex flex-col gap-2">
          {HISTORY_JOBS.slice(0, 4).map((j) => (
            <div key={j.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <span className="truncate pr-2" style={{ color: "var(--text)" }}>{j.title}</span>
              {statusChip(j.status)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: New Recap                                                    */
/* ------------------------------------------------------------------ */

function FilmstripStepper({ activeIndex, failedIndex, progress }) {
  const total = WORKFLOW_STEPS.length;
  const fillPct = failedIndex != null ? (failedIndex / (total - 1)) * 100 : activeIndex == null ? 0 : Math.min(100, ((activeIndex + (progress ? progress / 100 : 1)) / total) * 100);
  return (
    <div className="filmstrip">
      <div className="filmstrip-track px-3 pt-2 pb-1">
        <div className="filmstrip-rail"><div className="filmstrip-rail-fill" style={{ width: `${fillPct}%` }} /></div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
          {WORKFLOW_STEPS.map((step, i) => {
            const isFailed = failedIndex === i;
            const isDone = failedIndex == null && activeIndex != null && i < activeIndex;
            const isActive = failedIndex == null && activeIndex === i;
            let dotColor = "var(--border)"; let ring = "transparent";
            if (isFailed) { dotColor = "var(--danger)"; ring = "rgba(241,89,108,0.25)"; }
            else if (isDone) { dotColor = "var(--success)"; }
            else if (isActive) { dotColor = "var(--violet)"; ring = "rgba(139,124,246,0.25)"; }
            return (
              <div key={step.id} className="flex flex-col items-center gap-2 pt-1.5 relative">
                <div className="rounded-full flex items-center justify-center" style={{ width: 14, height: 14, background: dotColor, boxShadow: ring !== "transparent" ? `0 0 0 4px ${ring}` : "none" }}>
                  {isActive && <Loader2 size={9} className="spin-slow" color="#0B0D12" />}
                </div>
                <span className="text-[10.5px] text-center leading-tight px-1" style={{ color: isActive ? "var(--text)" : isFailed ? "var(--danger)" : "var(--text-faint)", maxWidth: 78 }}>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UploadPanel({ onFileChosen }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="rounded-2xl flex flex-col items-center justify-center text-center p-10 gap-3 cursor-pointer transition-colors"
      style={{ border: `1.5px dashed ${dragOver ? "var(--amber)" : "var(--border)"}`, background: dragOver ? "rgba(231,167,59,0.05)" : "var(--surface)" }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFileChosen(); }}
      onClick={onFileChosen}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onFileChosen(); }}
    >
      <div className="rounded-xl flex items-center justify-center" style={{ width: 46, height: 46, background: "var(--surface-3)" }}>
        <Upload size={20} style={{ color: "var(--amber)" }} />
      </div>
      <div className="blink-display text-base font-medium">Select a source video</div>
      <p className="text-sm max-w-xs" style={{ color: "var(--text-dim)" }}>Drag and drop a file here, or click to browse. Upload begins immediately once a valid file is selected.</p>
      <span className="text-xs" style={{ color: "var(--text-faint)" }}>MP4 · MOV · up to 15:00 duration</span>
      <span className="text-[11px] max-w-xs" style={{ color: "var(--text-faint)" }}>
        Accepted up to 15:00 (900 seconds) — a 14:59 or exactly 15:00 source is accepted; 15:01 or longer is rejected before upload starts. Billing still counts in 30-second blocks.
      </span>
    </div>
  );
}

function ConfiguredPanel({ onStart, fileName }) {
  return (
    <div className="p-5 md:p-6 flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <div className="rounded-lg flex items-center justify-center" style={{ width: 38, height: 38, background: "var(--surface-3)" }}>
          <Film size={17} style={{ color: "var(--amber)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{fileName}</div>
          <div className="text-xs" style={{ color: "var(--text-faint)" }}>Ready · pending job</div>
        </div>
        <Chip tone="success" icon={<CheckCircle2 size={12} />}>Uploaded</Chip>
      </div>

      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-dim)" }}>ESTIMATE</div>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span style={{ color: "var(--text-dim)" }}>Source length</span>
          <span className="blink-mono">6:20</span>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span style={{ color: "var(--text-dim)" }}>Duration limit</span>
          <span className="blink-mono">15:00 max</span>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span style={{ color: "var(--text-dim)" }}>Estimated cost</span>
          <span className="blink-mono">13 credits</span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 text-sm"><Settings2 size={15} style={{ color: "var(--text-dim)" }} /><span>Visual effects</span></div>
        <Chip tone="neutral" dashed>Configured in project settings</Chip>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button icon={<Play size={15} />} onClick={onStart}>Start Processing</Button>
        <Button variant="secondary">Discard</Button>
      </div>
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>Processing starts only after this explicit action — nothing runs automatically on upload.</p>
    </div>
  );
}

function ProcessingPanel({ progress, activeIndex, onCancel }) {
  const step = WORKFLOW_STEPS[Math.min(activeIndex, WORKFLOW_STEPS.length - 1)];
  return (
    <div className="p-5 md:p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><Loader2 size={16} className="spin-slow" style={{ color: "var(--violet)" }} /><span className="text-sm font-medium">{step.label}</span></div>
        <span className="blink-mono text-sm" style={{ color: "var(--text-dim)" }}>{Math.round(progress)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
        <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--violet), var(--amber))", transition: "width .4s ease" }} />
      </div>
      <p className="text-sm" style={{ color: "var(--text-dim)" }}>
        Action Movie Recap — Ep 04 is moving through the pipeline. This can safely run in the background; closing this tab won't cancel the job.
      </p>
      <div><Button variant="danger" size="sm" onClick={onCancel}>Cancel job</Button></div>
    </div>
  );
}

function CompletedPanel({ onReset }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-5 md:p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2"><CheckCircle2 size={17} style={{ color: "var(--success)" }} /><span className="text-sm font-medium">Recap complete</span></div>
      <div className="rounded-xl aspect-video flex items-center justify-center relative overflow-hidden" style={{ background: "linear-gradient(135deg, var(--surface-3), var(--bg-soft))", border: "1px solid var(--border)" }}>
        <div className="rounded-full flex items-center justify-center" style={{ width: 52, height: 52, background: "rgba(255,255,255,0.08)" }}><Play size={22} style={{ color: "var(--text)" }} /></div>
        <span className="absolute bottom-3 right-3 blink-mono text-xs px-2 py-1 rounded-md" style={{ background: "rgba(0,0,0,0.5)" }}>08:42</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button icon={<Download size={15} />}>Download MP4</Button>
        <Button variant="secondary" icon={<Eye size={15} />}>Preview</Button>
        <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={onReset}>Start a new recap</Button>
      </div>
      <div className="flex items-center justify-between text-sm rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text-dim)" }}>Credits charged</span>
        <span className="blink-mono">18</span>
      </div>
      <button className="flex items-center gap-1.5 text-xs font-medium blink-focus w-fit" style={{ color: "var(--text-dim)" }} onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {expanded ? "Hide" : "Show"} workflow detail
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5">
          {WORKFLOW_STEPS.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <span style={{ color: "var(--text-dim)" }}>{s.label}</span>
              <Chip tone="success" icon={<CheckCircle2 size={10} />}>Done</Chip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorPanel({ onRetry, onReset }) {
  return (
    <div className="p-5 md:p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2"><AlertTriangle size={17} style={{ color: "var(--danger)" }} /><span className="text-sm font-medium">Job failed</span></div>
      <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: "var(--danger-soft)", border: "1px solid rgba(241,89,108,0.3)" }}>
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--danger)" }}><KeyRound size={14} />Gemini key error (BYOK)</div>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>Your Gemini key was rejected during transcription. This job stays on your key — it will not silently switch to a Blink-funded run.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button icon={<RotateCcw size={15} />} onClick={onRetry}>Retry job</Button>
        <Button variant="secondary" onClick={onReset}>Start a new recap</Button>
      </div>
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>Your pending job and settings are preserved so you don't have to reconfigure anything before retrying.</p>
    </div>
  );
}

function NewRecapScreen({ phase, setPhase, progress, setProgress, activeIndex, setActiveIndex }) {
  const failedIndex = phase === "error" ? 2 : null;

  useEffect(() => {
    if (phase !== "processing") return;
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + 6;
        if (next >= 100) { clearInterval(id); setPhase("completed"); return 100; }
        return next;
      });
    }, 450);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    setActiveIndex(Math.min(WORKFLOW_STEPS.length - 1, Math.floor((progress / 100) * WORKFLOW_STEPS.length)));
  }, [progress, setActiveIndex]);

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto w-full">
      <SectionHeading eyebrow="Workspace" title="New Recap" desc="One stable workflow container — upload, review, process, and download without page jumps." />
      <div className="card overflow-hidden">
        <FilmstripStepper activeIndex={phase === "idle" ? null : activeIndex} failedIndex={failedIndex} progress={progress} />
        {phase === "idle" && <div className="p-5 md:p-6"><UploadPanel onFileChosen={() => setPhase("configured")} /></div>}
        {phase === "configured" && <ConfiguredPanel fileName="action-recap-source.mp4" onStart={() => { setProgress(0); setPhase("processing"); }} />}
        {phase === "processing" && <ProcessingPanel progress={progress} activeIndex={activeIndex} onCancel={() => setPhase("idle")} />}
        {phase === "completed" && <CompletedPanel onReset={() => { setPhase("idle"); setProgress(0); }} />}
        {phase === "error" && <ErrorPanel onRetry={() => { setProgress(40); setPhase("processing"); }} onReset={() => { setPhase("idle"); setProgress(0); }} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: History                                                      */
/* ------------------------------------------------------------------ */

function HistoryScreen() {
  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto w-full">
      <SectionHeading title="History" desc="Every workspace job you've started. Completed jobs and their media expire after the current 24-hour retention window." />
      <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
        {HISTORY_JOBS.map((j) => (
          <div key={j.id} className="flex items-center gap-3 p-4 flex-wrap" style={{ borderColor: "var(--border-soft)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 36, height: 36, background: "var(--surface-2)" }}><Film size={16} style={{ color: "var(--text-faint)" }} /></div>
            <div className="flex-1 min-w-[160px]">
              <div className="text-sm font-medium">{j.title}</div>
              <div className="text-xs blink-mono" style={{ color: "var(--text-faint)" }}>{j.id} · {j.duration}</div>
            </div>
            <div className="text-xs blink-mono" style={{ color: "var(--text-dim)" }}>{j.credits > 0 ? `${j.credits} credits` : "—"}</div>
            <div className="text-xs" style={{ color: "var(--text-faint)" }}>{j.updated}</div>
            {statusChip(j.status)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: Plans & Credits — active packages only, proof-upload flow    */
/* ------------------------------------------------------------------ */

function BuyFlow({ pkg, onClose }) {
  const [step, setStep] = useState("bank"); // bank -> proof -> submitted
  const [bank, setBank] = useState(ADMIN_BANKS[0].id);
  const [attached, setAttached] = useState(false);

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Buy {pkg.name} — {pkg.credits.toLocaleString()} credits</div>
        <button className="blink-focus" onClick={onClose}><X size={15} style={{ color: "var(--text-faint)" }} /></button>
      </div>

      {step === "bank" && (
        <>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>Transfer <span className="blink-mono">{pkg.price}</span> to one of these accounts, then continue.</p>
          <div className="flex flex-col gap-2">
            {ADMIN_BANKS.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm rounded-lg p-2.5" style={{ border: `1px solid ${bank === b.id ? "var(--amber)" : "var(--border)"}`, background: "var(--surface-2)" }}>
                <input type="radio" name="bank" checked={bank === b.id} onChange={() => setBank(b.id)} />
                <Landmark size={14} style={{ color: "var(--text-faint)" }} />
                <span className="flex-1">{b.name}</span>
                <span className="blink-mono text-xs" style={{ color: "var(--text-faint)" }}>{b.account}</span>
              </label>
            ))}
          </div>
          <Button onClick={() => setStep("proof")}>I've transferred the money</Button>
        </>
      )}

      {step === "proof" && (
        <>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>Attach a screenshot or photo of the transfer as payment proof.</p>
          <button
            onClick={() => setAttached(true)}
            className="blink-focus rounded-xl p-5 flex flex-col items-center gap-2 text-center"
            style={{ border: `1.5px dashed ${attached ? "var(--success)" : "var(--border)"}`, background: "var(--surface-2)" }}
          >
            <Paperclip size={18} style={{ color: attached ? "var(--success)" : "var(--text-faint)" }} />
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>{attached ? "payment_proof.jpg attached" : "Click to attach payment proof"}</span>
          </button>
          <Button disabled={!attached} onClick={() => setStep("submitted")}>Submit for manual review</Button>
        </>
      )}

      {step === "submitted" && (
        <div className="flex flex-col items-center text-center gap-2 py-4">
          <CheckCircle2 size={28} style={{ color: "var(--success)" }} />
          <div className="text-sm font-medium">Submitted</div>
          <p className="text-sm max-w-sm" style={{ color: "var(--text-dim)" }}>
            The Product Owner will check the bank account manually outside the app, then add {pkg.credits.toLocaleString()} matching credits to your balance. There's no automatic approval step.
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}

function PlansScreen({ user, packages }) {
  const [buying, setBuying] = useState(null);
  const activePackages = packages.filter((p) => p.status === "active");

  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto w-full">
      <SectionHeading title="Plans & credits" desc="Your current plan, balance, and history." />

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 md:col-span-1">
          <div className="text-xs" style={{ color: "var(--text-dim)" }}>Current plan</div>
          <div className="blink-display text-lg font-semibold mt-1">{user.plan}</div>
          <div className="mt-3 flex items-center gap-2">
            <Wallet size={14} style={{ color: "var(--text-faint)" }} />
            <span className="blink-mono text-xl">{user.credits}</span>
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>credits</span>
          </div>
        </div>

        <div className="card p-5 md:col-span-2">
          <div className="text-sm font-semibold mb-3">Recent balance activity</div>
          <div className="flex flex-col gap-2">
            {CREDIT_LEDGER.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm py-1" style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <span style={{ color: "var(--text-dim)" }} className="truncate pr-3">{l.label}</span>
                <span className="blink-mono shrink-0" style={{ color: l.delta > 0 ? "var(--success)" : "var(--text)" }}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-sm font-semibold mb-3">Credit packages</div>
        <div className="grid md:grid-cols-3 gap-3">
          {activePackages.map((p) => (
            <div key={p.id} className="card p-4 flex flex-col gap-2">
              <div className="blink-display font-semibold">{p.name}</div>
              <div className="blink-mono text-lg">{p.credits.toLocaleString()} <span className="text-xs" style={{ color: "var(--text-faint)" }}>credits</span></div>
              <div className="text-sm" style={{ color: "var(--text-dim)" }}>{p.price}</div>
              <Button size="sm" className="mt-1" onClick={() => setBuying(p)}>Buy</Button>
            </div>
          ))}
        </div>
      </div>

      {buying && <div className="mb-6"><BuyFlow pkg={buying} onClose={() => setBuying(null)} /></div>}

      <div className="card p-5 overflow-x-auto">
        <div className="text-sm font-semibold mb-3">Plan comparison</div>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-faint)" }} className="text-left">
              <th className="font-medium pb-2 pr-4 text-xs">Plan</th>
              <th className="font-medium pb-2 pr-4 text-xs">Gemini credential</th>
              <th className="font-medium pb-2 pr-4 text-xs">Credits</th>
              <th className="font-medium pb-2 pr-4 text-xs">Visual effects</th>
              <th className="font-medium pb-2 text-xs">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_TABLE.map((row) => (
              <tr key={row.plan} style={{ borderTop: "1px solid var(--border-soft)" }}>
                <td className="py-2.5 pr-4 font-medium">{row.plan}{row.plan === user.plan && <span className="ml-2"><Chip tone="amber">Current</Chip></span>}</td>
                <td className="py-2.5 pr-4" style={{ color: "var(--text-dim)" }}>{row.credential}</td>
                <td className="py-2.5 pr-4" style={{ color: "var(--text-dim)" }}>{row.credits}</td>
                <td className="py-2.5 pr-4" style={{ color: "var(--text-dim)" }}>{row.effects}</td>
                <td className="py-2.5" style={{ color: "var(--text-dim)" }}>{row.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>Pro is a billing plan, not a permission role. Admin and Super Admin remain separate permission roles.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen: Super Admin                                                   */
/* ------------------------------------------------------------------ */

function AdminTabs({ tab, setTab }) {
  const tabs = [
    { id: "users", label: "Users", icon: <Users size={14} /> },
    { id: "purchases", label: "Purchases", icon: <ReceiptText size={14} /> },
    { id: "packages", label: "Packages", icon: <Package size={14} /> },
    { id: "credits", label: "Credit corrections", icon: <Wallet size={14} /> },
    { id: "audit", label: "Audit log", icon: <ListChecks size={14} /> },
    { id: "system", label: "System status", icon: <ServerCog size={14} /> },
  ];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} className="blink-focus flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap"
          style={{ background: tab === t.id ? "var(--surface-3)" : "transparent", color: tab === t.id ? "var(--text)" : "var(--text-dim)", border: "1px solid " + (tab === t.id ? "var(--border)" : "transparent") }}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

function AdminUsersTab() {
  return (
    <div className="flex flex-col gap-3">
      <GatedNote>Ban / unban is planned but not yet implemented — controls below are disabled previews only.</GatedNote>
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>Role controls permissions (user / admin / super_admin). Plan controls billing (Trial / Normal / Pro). The two are independent — Pro is a plan, not a role.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-faint)" }} className="text-left">
              <th className="font-medium py-3 px-4 text-xs">User</th>
              <th className="font-medium py-3 px-4 text-xs">Role</th>
              <th className="font-medium py-3 px-4 text-xs">Plan</th>
              <th className="font-medium py-3 px-4 text-xs">Credits</th>
              <th className="font-medium py-3 px-4 text-xs">Status</th>
              <th className="font-medium py-3 px-4 text-xs">Ban / unban</th>
            </tr>
          </thead>
          <tbody>
            {ADMIN_USERS.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                <td className="py-3 px-4"><div className="font-medium">{u.name}</div><div className="text-xs" style={{ color: "var(--text-faint)" }}>{u.email}</div></td>
                <td className="py-3 px-4"><Chip tone={u.role === "super_admin" ? "amber" : u.role === "admin" ? "violet" : "neutral"}>{u.role}</Chip></td>
                <td className="py-3 px-4" style={{ color: "var(--text-dim)" }}>{u.plan}</td>
                <td className="py-3 px-4 blink-mono">{u.credits}</td>
                <td className="py-3 px-4"><Chip tone={u.status === "active" ? "success" : "danger"}>{u.status}</Chip></td>
                <td className="py-3 px-4">
                  <button disabled className="chip" style={{ borderStyle: "dashed", color: "var(--text-faint)", cursor: "not-allowed", background: "transparent" }} title="Ban/unban is not yet implemented">
                    <Ban size={12} /> Not available
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminPurchasesTab({ purchases, setPurchases, addAudit }) {
  const [addingFor, setAddingFor] = useState(null);
  const [reason, setReason] = useState("");

  const confirmAdd = (p) => {
    setPurchases((all) => all.map((x) => (x.id === p.id ? { ...x, status: "credits_added", addedAt: "Just now" } : x)));
    addAudit(`Added ${p.credits.toLocaleString()} credits to ${p.user} for purchase ${p.id} — reason: ${reason || "bank transfer verified manually"}`);
    setAddingFor(null);
    setReason("");
  };

  return (
    <div className="flex flex-col gap-3">
      <GatedNote>Users upload payment proof after transferring money. The Product Owner checks the bank manually outside this app, then adds the matching credits here — there is no in-app approve/reject step.</GatedNote>
      <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
        {purchases.map((p) => (
          <div key={p.id} className="p-4 flex flex-col gap-3" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <div className="text-sm font-medium">{p.user}</div>
                <div className="text-xs" style={{ color: "var(--text-faint)" }}>{p.packageName} · {p.credits.toLocaleString()} credits · {p.amount} · {p.bank}</div>
              </div>
              <button className="chip" style={{ background: "transparent", color: "var(--text-dim)" }} title={p.proof}>
                <Paperclip size={12} /> View proof
              </button>
              <div className="text-xs" style={{ color: "var(--text-faint)" }}>{p.submitted}</div>
              {statusChip(p.status)}
              {p.status === "awaiting_review" && (
                <Button size="sm" onClick={() => setAddingFor(p.id)}>Add matching credits</Button>
              )}
            </div>
            {addingFor === p.id && (
              <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--text-dim)" }}>Credits to add</span>
                  <span className="blink-mono">{p.credits.toLocaleString()}</span>
                </div>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={`Reason (e.g. bank transfer for ${p.id} verified manually)`}
                  className="blink-focus text-sm rounded-lg px-3 py-2"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => confirmAdd(p)}>Confirm add credits</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingFor(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {p.status === "credits_added" && (
              <div className="text-xs" style={{ color: "var(--text-faint)" }}>Credits added {p.addedAt}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPackagesTab({ packages, setPackages }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", credits: "", price: "" });

  const move = (id, dir) => {
    setPackages((list) => {
      const idx = list.findIndex((p) => p.id === id);
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= list.length) return list;
      const copy = [...list];
      [copy[idx], copy[swapWith]] = [copy[swapWith], copy[idx]];
      return copy;
    });
  };

  const setStatus = (id, status) => setPackages((list) => list.map((p) => (p.id === id ? { ...p, status } : p)));

  const startEdit = (p) => { setEditing(p.id); setDraft({ name: p.name, credits: p.credits, price: p.price }); };
  const saveEdit = () => {
    setPackages((list) => list.map((p) => (p.id === editing ? { ...p, name: draft.name, credits: Number(draft.credits) || p.credits, price: draft.price } : p)));
    setEditing(null);
  };

  const createPackage = () => {
    if (!draft.name) return;
    setPackages((list) => [...list, { id: `pkg_${Date.now()}`, name: draft.name, credits: Number(draft.credits) || 0, price: draft.price || "—", status: "inactive" }]);
    setDraft({ name: "", credits: "", price: "" });
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>Normal users see active packages only. Inactive and archived packages stay hidden from the buy flow.</p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => { setCreating(true); setDraft({ name: "", credits: "", price: "" }); }}>Create package</Button>
      </div>

      {creating && (
        <div className="card p-4 flex flex-col gap-2">
          <div className="text-sm font-semibold">New package</div>
          <div className="grid md:grid-cols-3 gap-2">
            <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
            <input placeholder="Credits" value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
            <input placeholder="Price (e.g. 50,000 MMK)" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={createPackage}>Save package</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
        {packages.map((p, i) => (
          <div key={p.id} className="p-4 flex flex-col gap-2" style={{ borderColor: "var(--border-soft)" }}>
            {editing === p.id ? (
              <div className="flex flex-col gap-2">
                <div className="grid md:grid-cols-3 gap-2">
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
                  <input value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
                  <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex flex-col shrink-0">
                  <button disabled={i === 0} onClick={() => move(p.id, -1)} className="blink-focus disabled:opacity-30"><ArrowUp size={13} style={{ color: "var(--text-faint)" }} /></button>
                  <button disabled={i === packages.length - 1} onClick={() => move(p.id, 1)} className="blink-focus disabled:opacity-30"><ArrowDown size={13} style={{ color: "var(--text-faint)" }} /></button>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs blink-mono" style={{ color: "var(--text-faint)" }}>{p.credits.toLocaleString()} credits · {p.price}</div>
                </div>
                {statusChip(p.status)}
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => startEdit(p)}>Edit</Button>
                  {p.status !== "active" && <Button size="sm" variant="secondary" icon={<Power size={13} />} onClick={() => setStatus(p.id, "active")}>Activate</Button>}
                  {p.status === "active" && <Button size="sm" variant="secondary" icon={<PowerOff size={13} />} onClick={() => setStatus(p.id, "inactive")}>Deactivate</Button>}
                  {p.status !== "archived" && <Button size="sm" variant="ghost" icon={<Archive size={13} />} onClick={() => setStatus(p.id, "archived")}>Archive</Button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminCreditsTab({ addAudit }) {
  const [target, setTarget] = useState(ADMIN_USERS[0].email);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState(null);

  const apply = (direction) => {
    if (!amount || !reason) return;
    const user = ADMIN_USERS.find((u) => u.email === target);
    addAudit(`${direction === "add" ? "Added" : "Deducted"} ${amount} credits ${direction === "add" ? "to" : "from"} ${user?.name || target} — reason: ${reason}`);
    setConfirmation(`${direction === "add" ? "Added" : "Deducted"} ${amount} credits ${direction === "add" ? "to" : "from"} ${user?.name || target}.`);
    setAmount("");
    setReason("");
  };

  return (
    <div className="flex flex-col gap-4">
      <GatedNote>Credit corrections use Add or Deduct only. Every change requires a reason and is recorded in the audit log — there is no separate refund or reversal action.</GatedNote>
      <div className="card p-5 flex flex-col gap-3 max-w-lg">
        <div className="text-sm font-semibold">Manual credit correction</div>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}>
          {ADMIN_USERS.map((u) => <option key={u.id} value={u.email}>{u.name} — {u.email}</option>)}
        </select>
        <input placeholder="Amount (credits)" value={amount} onChange={(e) => setAmount(e.target.value)} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
        <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="blink-focus text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
        <div className="flex gap-2">
          <Button size="sm" icon={<Plus size={13} />} onClick={() => apply("add")} disabled={!amount || !reason}>Add credits</Button>
          <Button size="sm" variant="danger" icon={<Minus size={13} />} onClick={() => apply("deduct")} disabled={!amount || !reason}>Deduct credits</Button>
        </div>
        {confirmation && <div className="text-xs" style={{ color: "var(--success)" }}>{confirmation}</div>}
      </div>

      <div className="card p-5">
        <div className="text-sm font-semibold mb-3">Plan rates</div>
        <div className="flex flex-col gap-2">
          {ADMIN_RATES.map((r) => (
            <div key={r.plan} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <span>{r.plan}</span>
              <span style={{ color: "var(--text-dim)" }}>{r.rate}</span>
            </div>
          ))}
        </div>
        <GatedNote>Rates shown are illustrative — no commercial values are seeded until billing activation.</GatedNote>
      </div>

      <div className="card p-5">
        <div className="text-sm font-semibold mb-3">Bank accounts</div>
        <div className="flex flex-col gap-2">
          {ADMIN_BANKS.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <div className="flex items-center gap-2"><Landmark size={14} style={{ color: "var(--text-faint)" }} />{b.name}</div>
              <span className="blink-mono text-xs" style={{ color: "var(--text-dim)" }}>{b.account} · {b.currency}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminAuditTab({ auditLog }) {
  return (
    <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
      {auditLog.map((a) => (
        <div key={a.id} className="p-4 flex items-start gap-3" style={{ borderColor: "var(--border-soft)" }}>
          <CircleDot size={13} style={{ color: "var(--text-faint)", marginTop: 3 }} />
          <div className="flex-1">
            <div className="text-sm">{a.action}</div>
            <div className="text-xs blink-mono" style={{ color: "var(--text-faint)" }}>{a.actor} · {a.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminSystemStatusTab() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <StatCard icon={<ServerCog size={16} />} value="200 OK" label="/api/health response" />
      <StatCard icon={<Gauge size={16} />} value="1 / 1" label="Running replicas" />
      <StatCard icon={<Clock size={16} />} value="—" label="Uptime (owner/super admin view only)" />
      <StatCard icon={<FileClock size={16} />} value="Node 20" label="Runtime" />
      <div className="md:col-span-2">
        <GatedNote>System status is restricted to Owner and Super Admin. It no longer appears anywhere in the user or general dashboard.</GatedNote>
      </div>
    </div>
  );
}

function AdminScreen({ purchases, setPurchases, packages, setPackages, auditLog, addAudit }) {
  const [tab, setTab] = useState("users");
  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto w-full">
      <SectionHeading
        eyebrow="Restricted"
        title="Super Admin"
        desc="min85639@gmail.com is the intended sole Product Owner / Super Admin. Enforcement of that is not yet complete in the backend."
        right={<Chip tone="amber" icon={<ShieldCheck size={12} />}>super_admin only</Chip>}
      />
      <AdminTabs tab={tab} setTab={setTab} />
      {tab === "users" && <AdminUsersTab />}
      {tab === "purchases" && <AdminPurchasesTab purchases={purchases} setPurchases={setPurchases} addAudit={addAudit} />}
      {tab === "packages" && <AdminPackagesTab packages={packages} setPackages={setPackages} />}
      {tab === "credits" && <AdminCreditsTab addAudit={addAudit} />}
      {tab === "audit" && <AdminAuditTab auditLog={auditLog} />}
      {tab === "system" && <AdminSystemStatusTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview tools — hidden by default, never part of the real product UI */
/* ------------------------------------------------------------------ */

function PreviewTools({ role, setRole, phase, setPhase, setProgress }) {
  const [open, setOpen] = useState(false);
  const phases = [
    { id: "idle", label: "Idle" },
    { id: "configured", label: "Configured" },
    { id: "processing", label: "Processing" },
    { id: "completed", label: "Completed" },
    { id: "error", label: "Error" },
  ];
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="rounded-xl p-3 flex flex-col gap-2.5 w-72" style={{ background: "var(--surface-2)", border: "1px dashed var(--text-faint)" }}>
          <div className="text-[10px] font-semibold" style={{ color: "var(--text-faint)", letterSpacing: "0.05em" }}>PREVIEW-ONLY — not part of the product</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Role</span>
            {["user", "super_admin"].map((r) => (
              <button key={r} onClick={() => setRole(r)} className="blink-focus text-xs px-2.5 py-1 rounded-md font-medium"
                style={{ background: role === r ? "var(--violet)" : "var(--surface-3)", color: role === r ? "#0B0D12" : "var(--text-dim)" }}>
                {r === "user" ? "Normal user" : "Super Admin"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>New Recap state</span>
            {phases.map((p) => (
              <button key={p.id} onClick={() => { setPhase(p.id); setProgress(p.id === "completed" ? 100 : p.id === "processing" ? 10 : 0); }}
                className="blink-focus text-xs px-2.5 py-1 rounded-md font-medium"
                style={{ background: phase === p.id ? "var(--text)" : "var(--surface-3)", color: phase === p.id ? "var(--bg)" : "var(--text-dim)" }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} className="blink-focus rounded-full flex items-center justify-center" style={{ width: 40, height: 40, background: "var(--surface-3)", border: "1px dashed var(--text-faint)", color: "var(--text-faint)" }} title="Preview tools (not part of the product)">
        <Settings size={17} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                  */
/* ------------------------------------------------------------------ */

export default function BlinkAutomationUIPreview() {
  const [screen, setScreen] = useState("login");
  const [role, setRole] = useState("user");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const [purchases, setPurchases] = useState(INITIAL_PURCHASES);
  const [packages, setPackages] = useState(INITIAL_PACKAGES);
  const [auditLog, setAuditLog] = useState(INITIAL_AUDIT_LOG);

  const addAudit = (action) => {
    setAuditLog((log) => [{ id: `a_${Date.now()}`, actor: MOCK_ADMIN.email, action, time: "Just now" }, ...log]);
  };

  const user = role === "super_admin" ? MOCK_ADMIN : MOCK_USER;

  const handleLogin = () => setScreen(role === "super_admin" ? "dashboard" : "newrecap");
  const handleLogout = () => { setMobileMenuOpen(false); setScreen("login"); };

  return (
    <div className="blink-root h-full min-h-screen flex flex-col">
      <style>{CSS}</style>

      {screen === "login" ? (
        <LoginScreen onLogin={handleLogin} />
      ) : (
        <div className="flex flex-1 min-h-0">
          <Sidebar screen={screen} setScreen={setScreen} role={role} user={user} onLogout={handleLogout} />
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <MobileHeader onOpen={() => setMobileMenuOpen(true)} user={user} />
            <main className="flex-1 min-w-0 overflow-y-auto">
            {screen === "dashboard" && role === "super_admin" && <DashboardScreen setScreen={setScreen} purchases={purchases} />}
            {screen === "newrecap" && (
              <NewRecapScreen phase={phase} setPhase={setPhase} progress={progress} setProgress={setProgress} activeIndex={activeIndex} setActiveIndex={setActiveIndex} />
            )}
            {screen === "history" && <HistoryScreen />}
            {screen === "plans" && <PlansScreen user={user} packages={packages} />}
            {screen === "admin" && role === "super_admin" && (
              <AdminScreen purchases={purchases} setPurchases={setPurchases} packages={packages} setPackages={setPackages} auditLog={auditLog} addAudit={addAudit} />
            )}
            </main>
          </div>
          <MobileDrawer
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            screen={screen}
            setScreen={setScreen}
            role={role}
            user={user}
            onLogout={handleLogout}
          />
        </div>
      )}

      <PreviewTools role={role} setRole={setRole} phase={phase} setPhase={setPhase} setProgress={setProgress} />
    </div>
  );
}
