import { Loader2 } from 'lucide-react';

// No reference equivalent; minimal reuse of .centered-page/.panel/.bigicon.
export function SessionLoading() {
  return (
    <main className="centered-page" aria-busy="true" aria-live="polite">
      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="bigicon" style={{ margin: '0 auto 18px' }}><span className="spin" aria-hidden="true"><Loader2 size={28} /></span></div>
        <h1 style={{ margin: '0 0 8px' }}>အလုပ်နေရာ ပြန်ဖွင့်နေသည်</h1>
        <p className="muted">Blink Session ကို လုံခြုံစွာ စစ်ဆေးနေသည်…</p>
      </div>
    </main>
  );
}
