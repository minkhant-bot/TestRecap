import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';

const PIPELINE_PREVIEW = ['ဗီဒီယိုတင်ခြင်း', 'အသံခွဲထုတ်ခြင်း', 'မြန်မာဘာသာပြန်ခြင်း', 'အသံထွက်ဖန်တီးခြင်း'];

const FEATURES: Array<[string, string, string]> = [
  ['01', 'အချိန်ကုန်သက်သာမှု', 'Manual editing အဆင့်များစွာကို လျှော့ချပြီး Recap တစ်ပုဒ်ဖန်တီးချိန်ကို တိုစေပါတယ်။'],
  ['02', 'သဘာဝကျတဲ့ မြန်မာအသံ', 'ကြည့်ရှုသူနားထောင်ရအဆင်ပြေတဲ့ မြန်မာ narration အဖြစ် ဖန်တီးပေးပါတယ်။'],
  ['03', 'Download လုပ်ပြီး အသင့်သုံး', 'ပြီးဆုံးသွားတဲ့ MP4 Video ကို preview ကြည့်ပြီး တိုက်ရိုက် download လုပ်နိုင်ပါတယ်။'],
];

const STEPS: Array<[string, string, string]> = [
  ['01', 'ဗီဒီယိုတင်ပါ', 'ဖန်တီးချင်တဲ့ မူရင်း Movie Video ကို Workspace ထဲတင်ပါ။'],
  ['02', 'Blink ကို လုပ်ခိုင်းပါ', 'Recap settings ကိုရွေးပြီး Generate လုပ်ပါ။ ကျန်တာအားလုံးကို AI က ဆောင်ရွက်ပါမယ်။'],
  ['03', 'ကြည့်ပြီး Download လုပ်ပါ', 'ပြီးဆုံးတဲ့ video ကို preview ကြည့်ပြီး MP4 အဖြစ် ရယူပါ။'],
];

// Rule #1/#4 (frozen): Normal is removed. Trial is one-time and request-only
// (never self-selected — the actual "Request Trial" action lives on the
// authenticated Plans & Credits page, after Owner approval is required
// anyway); Pro is granted automatically only by an approved package
// purchase, never self-selected. These landing cards describe that flow
// rather than offering direct plan selection — both buttons only ever lead
// to sign-in, matching what's actually possible before authentication.
const PLANS: Array<{ name: string; tagline: string; blurb: string; items: string[]; cta: string; highlighted?: boolean }> = [
  {
    name: 'Trial', tagline: 'အခမဲ့ တစ်ကြိမ်စမ်းသပ်ရန်', blurb: 'Owner အတည်ပြုပြီးမှ ရရှိမည် — Credit ၁၂ ခု, ၅ ရက်အတွင်း',
    items: ['Credits ၁၂ ခု (တစ်ကြိမ်သာ)', '၅ ရက်အတွင်း သက်တမ်းရှိသည်', 'Standard processing'],
    cta: 'အကောင့်ဝင်ပြီး Trial တောင်းဆိုမည်',
  },
  {
    name: 'Pro', tagline: 'Package ဝယ်ယူသူများအတွက်', blurb: 'အတည်ပြုပြီးသော ဝယ်ယူမှုတိုင်းက Pro ကို အလိုအလျောက် ပေးအပ်သည်',
    items: ['ဝယ်ယူထားသော Credits', 'Visual effects အပြည့်အစုံ', 'Credits ကုန်ဆုံးလျှင်ပင် Pro ဆက်ရှိနေမည်'],
    cta: 'အကောင့်ဝင်ပြီး Package ဝယ်ယူမည်', highlighted: true,
  },
];

const FAQ: Array<[string, string]> = [
  ['Blink က ဘာလုပ်ပေးတာလဲ။', 'Movie Video တစ်ခုကနေ မြန်မာအသံပါဝင်တဲ့ Recap Video အဖြစ် အလိုအလျောက်ဖန်တီးပေးပါတယ်။'],
  ['Final video ကို Download လုပ်လို့ရလား။', 'ရပါတယ်။ Processing ပြီးသွားတဲ့အခါ Preview ကြည့်နိုင်ပြီး MP4 အဖြစ် Download လုပ်နိုင်ပါတယ်။'],
  ['စတင်ဖို့ ဘာလိုအပ်လဲ။', 'Google အကောင့်တစ်ခုနှင့် မူရင်းဗီဒီယိုတစ်ခုသာ လိုအပ်ပါတယ်။'],
];

function Brand() {
  return (
    <Link to="/" className="brand"><span className="mark" />Blink</Link>
  );
}

const NAV_LINKS: Array<[string, string]> = [
  ['#features', 'လုပ်ဆောင်ချက်များ'],
  ['#how', 'အသုံးပြုပုံ'],
  ['#pricing', 'ဈေးနှုန်း'],
  ['#faq', 'မေးလေ့ရှိသည်များ'],
];

export function LandingPage() {
  const { profile, loading } = useAuth();
  const [openFaq, setOpenFaq] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!loading && profile) {
    return <Navigate to={profile.role === 'super_admin' ? '/admin' : '/new-recap'} replace />;
  }

  return (
    <div className="landing-page">
      <div className="topbar">
        <div className="shell topbarin">
          <Brand />
          <div className="navlinks">
            {NAV_LINKS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
          </div>
          <div className="actions">
            <Link to="/login" className="btn ghost">အကောင့်ဝင်ရန်</Link>
            <Link to="/login" className="btn accent">အခမဲ့စတင်မည်</Link>
            <button
              type="button"
              className="navToggle"
              onClick={() => setMobileNavOpen(value => !value)}
              aria-expanded={mobileNavOpen}
              aria-controls="landing-mobile-nav"
              aria-label={mobileNavOpen ? 'မီနူးပိတ်မည်' : 'မီနူးဖွင့်မည်'}
            >
              {mobileNavOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className={`mobileNavPanel${mobileNavOpen ? ' is-open' : ''}`} id="landing-mobile-nav" aria-hidden={!mobileNavOpen}>
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href} tabIndex={mobileNavOpen ? 0 : -1} onClick={() => setMobileNavOpen(false)}>{label}</a>
          ))}
          <Link to="/login" tabIndex={mobileNavOpen ? 0 : -1} onClick={() => setMobileNavOpen(false)}>အကောင့်ဝင်ရန်</Link>
        </div>
      </div>

      <section className="hero shell">
        <span className="badge"><i />မြန်မာ Movie Recap Creator များအတွက်</span>
        <h1>
          Movie Recap Video ကို<br />
          <span>AI နဲ့ အလိုအလျောက်</span><br />
          ဖန်တီးပါ
        </h1>
        <p>ဗီဒီယိုတင်ပါ။ မြန်မာအသံပါတဲ့ Recap Video ကို Blink က ဖန်တီးပေးပါမယ်။</p>
        <div className="heroactions">
          <Link to="/login" className="btn accent">အခမဲ့ စမ်းသုံးမည် →</Link>
          <a href="#preview" className="btn">Preview ကြည့်မည် ▶</a>
        </div>
        <div className="trust">Credit card မလိုပါ · Google အကောင့်ဖြင့် စတင်နိုင်ပါသည်</div>

        <div className="preview" id="preview">
          <div className="window">
            <div className="winbar"><span className="dot" /><span className="dot" /><span className="dot" /></div>
            <div className="mockgrid">
              <aside className="mockside">
                <div className="is-active">New Recap</div>
                <div>History</div>
                <div>Plans &amp; Credits</div>
              </aside>
              <div className="mockmain">
                <div className="kicker">NEW RECAP</div>
                <h3>Recap အသစ်</h3>
                <p className="muted">မူရင်းဗီဒီယိုကို ရွေးချယ်တင်ပါ။</p>
                <div className="drop" style={{ marginTop: 27 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className="bigicon">↑</div>
                    <strong>ဗီဒီယိုကို ဒီနေရာမှာ တင်ပါ</strong>
                    <p className="muted">MP4, MOV</p>
                  </div>
                </div>
                <div className="row wrap" style={{ marginTop: 18 }}>
                  {PIPELINE_PREVIEW.map((stage, index) => (
                    <span key={stage} className="chip">{index === 0 ? '✓ ' : ''}{stage}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section shell" id="features">
        <div className="sectionhead">
          <div><div className="kicker">WHY BLINK</div><h2>Content ဖန်တီးရာမှာ<br />အချိန်ကို ပြန်ရယူပါ</h2></div>
          <p>Recap ဖန်တီးဖို့လိုတာအားလုံးကို Workspace တစ်ခုထဲမှာ စုစည်းထားပါတယ်။</p>
        </div>
        <div className="grid3">
          {FEATURES.map(([num, title, body]) => (
            <article className="card" key={num}>
              <span className="cardnum">{num}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell" id="how">
        <div className="sectionhead">
          <div><div className="kicker">SIMPLE WORKFLOW</div><h2>သုံးဆင့်နဲ့ ပြီးပါပြီ</h2></div>
          <p>ရှုပ်ထွေးတဲ့အဆင့်တွေကို Blink က တာဝန်ယူပါတယ်။</p>
        </div>
        <div className="steps">
          {STEPS.map(([num, title, body]) => (
            <div className="step" key={num}>
              <b>{num}</b>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section shell" id="pricing">
        <div className="sectionhead">
          <div><div className="kicker">PLANS</div><h2>သင့်အလုပ်နဲ့ ကိုက်ညီတဲ့ Plan</h2></div>
          <p>Pro သည် billing plan ဖြစ်ပြီး admin role မဟုတ်ပါ။ တိကျသော ဈေးနှုန်းကို အကောင့်ဝင်ပြီးမှ ကြည့်ရှုနိုင်ပါသည်။</p>
        </div>
        <div className="pricegrid">
          {PLANS.map(plan => (
            <div className={`price ${plan.highlighted ? 'hot' : ''}`} key={plan.name}>
              {plan.highlighted && <span className="flag">လူကြိုက်များ</span>}
              <small>{plan.tagline}</small>
              <h3>{plan.name}</h3>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>{plan.blurb}</p>
              <ul>{plan.items.map(item => <li key={item}>{item}</li>)}</ul>
              <Link to="/login" className={`btn ${plan.highlighted ? 'accent' : ''}`} style={{ width: '100%' }}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="section shell" id="faq">
        <div className="sectionhead">
          <div><div className="kicker">FAQ</div><h2>မေးလေ့ရှိတာများ</h2></div>
        </div>
        {FAQ.map(([question, answer], index) => (
          <div className={`faqitem ${openFaq === index ? 'open' : ''}`} key={question}>
            <button type="button" className="faqbtn" onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}>
              {question}<span>{openFaq === index ? '−' : '+'}</span>
            </button>
            <div className="faqans"><div>{answer}</div></div>
          </div>
        ))}
      </section>

      <section className="shell cta">
        <h2>နောက် Recap ကို Blink နဲ့ စတင်ပါ</h2>
        <p className="muted">အချိန်ကုန်သက်သာပြီး ပိုမိုမြန်ဆန်တဲ့ AI Production Workflow ကို စမ်းသုံးကြည့်ပါ။</p>
        <Link to="/login" className="btn accent">Google ဖြင့် အခမဲ့စတင်မည်</Link>
      </section>

      <footer className="landing-footer">
        <div className="shell row between wrap"><Brand /><div>© 2026 Blink Automation</div></div>
      </footer>
    </div>
  );
}
