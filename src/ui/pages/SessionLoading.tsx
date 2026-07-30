export function SessionLoading() {
  return (
    <main className="ds-session-state" aria-busy="true" aria-live="polite">
      <div className="ds-session-state__brand" aria-hidden="true">T</div>
      <span className="ds-session-state__spinner" aria-hidden="true" />
      <h1>အလုပ်နေရာ ပြန်ဖွင့်နေသည်</h1>
      <p>TestRecap Session ကို လုံခြုံစွာ စစ်ဆေးနေသည်…</p>
    </main>
  );
}
