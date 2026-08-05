import React, { useMemo, useState } from "react";

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+Myanmar:wght@400;500;600;700&display=swap');

:root{
  --bg:#050505;
  --panel:#0c0c10;
  --panel2:#111116;
  --line:rgba(255,255,255,.09);
  --line2:rgba(255,255,255,.16);
  --text:#f7f7f8;
  --muted:#9898a2;
  --accent:#ff2d7d;
  --accentSoft:rgba(255,45,125,.14);
  --danger:#ff5d6c;
  --success:#54d39b;
  --warning:#f5bd56;
}
*{box-sizing:border-box}
html,body,#root{margin:0;min-height:100%;background:var(--bg)}
body{font-family:"Noto Sans Myanmar","Manrope",system-ui,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.7;overflow-wrap:anywhere}
button,input,select{font:inherit}
button{cursor:pointer}
a{color:inherit;text-decoration:none}
.app{
  min-height:100vh;
  background:
    radial-gradient(720px 400px at 82% 3%,rgba(255,45,125,.14),transparent 65%),
    radial-gradient(480px 300px at 0% 28%,rgba(255,45,125,.06),transparent 70%),
    var(--bg);
}
.shell{width:min(1180px,calc(100% - 32px));margin:0 auto}
.topbar{
  position:sticky;top:0;z-index:40;height:72px;border-bottom:1px solid rgba(255,255,255,.06);
  background:rgba(5,5,5,.78);backdrop-filter:blur(18px)
}
.topbarin{height:100%;display:flex;align-items:center;justify-content:space-between;gap:20px}
.brand{display:flex;align-items:center;gap:11px;font:800 20px "Manrope",sans-serif}
.mark{
  width:34px;height:34px;border:1px solid var(--line2);border-radius:11px;background:#0e0e12;display:grid;place-items:center
}
.mark:before{content:"";width:13px;height:13px;border:2px solid white;border-left-color:transparent;transform:rotate(-45deg);border-radius:3px}
.navlinks{display:flex;gap:24px;color:#aaaab3;font-size:14px}
.actions{display:flex;gap:10px;align-items:center}
.btn{
  min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--line2);background:#111116;color:white;
  transition:.2s ease
}
.btn:hover{transform:translateY(-1px);background:#17171d}
.btn.primary{background:white;color:#09090b;border-color:white;font-weight:700}
.btn.accent{background:var(--accent);border-color:var(--accent);font-weight:700;box-shadow:0 12px 42px rgba(255,45,125,.2)}
.btn.ghost{background:transparent}
.btn.danger{background:rgba(255,93,108,.12);border-color:rgba(255,93,108,.4);color:#ff9da8}
.badge{
  display:inline-flex;align-items:center;gap:9px;padding:8px 13px;border:1px solid var(--line);
  border-radius:999px;color:#d7d7dc;background:rgba(255,255,255,.03);font-size:13px
}
.badge i{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent)}
.hero{padding:82px 0 54px;text-align:center}
.hero h1{font-size:clamp(40px,6.7vw,82px);line-height:1.32;letter-spacing:-.02em;margin:27px auto 20px;max-width:970px}
.hero h1 span{color:var(--accent)}
.hero p{max-width:680px;margin:auto;color:#b0b0b9;font-size:clamp(15px,2vw,18px);line-height:1.95}
.heroactions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:29px}
.trust{margin-top:22px;color:#777782;font-size:13px}
.preview{
  margin-top:52px;padding:1px;border-radius:30px;background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.03));
  box-shadow:0 50px 140px rgba(0,0,0,.72);overflow:hidden
}
.window{background:#09090c;border-radius:29px;overflow:hidden;text-align:left}
.winbar{height:56px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 17px;gap:8px}
.dot{width:9px;height:9px;border-radius:50%;background:#2d2d32}
.dot:nth-child(1){background:#ff5f57}.dot:nth-child(2){background:#febc2e}.dot:nth-child(3){background:#28c840}
.mockgrid{display:grid;grid-template-columns:210px 1fr;min-height:410px}
.mockside{border-right:1px solid var(--line);padding:20px 14px}
.mockside div{padding:11px 12px;border-radius:10px;color:#74747e;font-size:13px;margin-bottom:4px}
.mockside div:first-child{background:#17171d;color:white}
.mockmain{padding:32px}
.kicker{font:700 12px "Manrope";letter-spacing:.18em;color:var(--accent);text-transform:uppercase}
.mockmain h3{font-size:29px;margin:8px 0 6px}
.muted{color:var(--muted)}
.drop{
  margin-top:27px;border:1px dashed rgba(255,255,255,.14);border-radius:20px;min-height:185px;display:grid;place-items:center;text-align:center;
  background:radial-gradient(390px 150px at 50% 0%,rgba(255,45,125,.08),transparent)
}
.section{padding:90px 0}
.sectionhead{display:flex;align-items:end;justify-content:space-between;gap:28px;margin-bottom:30px}
.section h2{font-size:clamp(32px,4.7vw,54px);line-height:1.4;letter-spacing:-.018em;margin:8px 0}
.sectionhead p{max-width:470px;line-height:1.8;color:var(--muted)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{
  border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,#101014,#0a0a0d);padding:25px;min-height:230px
}
.card h3{font-size:20px;line-height:1.55;margin:36px 0 9px}.card p{line-height:1.8;color:var(--muted);margin:0;font-size:14px}
.cardnum{font:700 12px "Manrope";letter-spacing:.14em;color:var(--accent)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.step{padding:30px 26px;border-right:1px solid var(--line);min-height:205px}
.step:last-child{border-right:0}.step b{font:800 50px "Manrope";color:#24242a}.step p{color:var(--muted);line-height:1.8}
.pricegrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.price{border:1px solid var(--line);border-radius:26px;background:#0c0c10;padding:27px;position:relative}
.price.hot{border-color:rgba(255,45,125,.5);box-shadow:0 24px 90px rgba(255,45,125,.1)}
.flag{position:absolute;right:18px;top:18px;background:var(--accent);padding:6px 9px;border-radius:999px;font-size:11px;font-weight:700}
.money{font:800 42px "Manrope";margin:10px 0 18px}.money span{font-size:14px;color:#777782}
.price ul{list-style:none;padding:0;margin:0 0 22px}.price li{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05);color:#b5b5bd;font-size:14px}
.price li:before{content:"✓";color:var(--accent);margin-right:10px}
.faqitem{border-top:1px solid var(--line)}.faqitem:last-child{border-bottom:1px solid var(--line)}
.faqbtn{width:100%;padding:22px 0;background:none;border:0;color:white;text-align:left;display:flex;justify-content:space-between;font-size:17px}
.faqans{display:none;padding:0 0 20px;color:var(--muted);line-height:1.8}.faqitem.open .faqans{display:block}
.cta{margin:30px auto 80px;padding:50px;border:1px solid var(--line);border-radius:30px;text-align:center;background:radial-gradient(470px 210px at 50% 0%,rgba(255,45,125,.18),transparent 70%),#0b0b0e}
footer{border-top:1px solid var(--line);padding:30px 0;color:#777782;font-size:13px}

.workspaceApp{min-height:100vh;display:grid;grid-template-columns:250px 1fr;background:#070708}
.sidebar{border-right:1px solid var(--line);padding:22px 16px;position:sticky;top:0;height:100vh;background:#09090c}
.sidebrand{margin-bottom:28px}
.sidenav button{
  width:100%;border:0;background:transparent;color:#85858f;text-align:left;padding:12px 13px;border-radius:11px;margin-bottom:5px
}
.sidenav button.active{background:#17171d;color:white}.sidenav button:hover{background:#121217;color:white}
.sidebottom{position:absolute;bottom:20px;left:16px;right:16px}
.creditbox{padding:14px;border:1px solid var(--line);border-radius:15px;background:#0f0f13}
.mainarea{min-width:0}
.appheader{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 28px;position:sticky;top:0;background:rgba(7,7,8,.84);backdrop-filter:blur(16px);z-index:20}
.apppage{padding:28px;max-width:1100px;margin:0 auto}
.pagetitle{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:24px}
.pagetitle h1{font-size:clamp(27px,4vw,34px);line-height:1.45;margin:0 0 7px}.pagetitle p{margin:0;color:var(--muted);line-height:1.8}
.panel{border:1px solid var(--line);background:#0d0d11;border-radius:24px;padding:24px}
.uploadpanel{min-height:390px;display:grid;place-items:center;text-align:center;background:radial-gradient(460px 180px at 50% 0%,rgba(255,45,125,.11),transparent 70%),#0d0d11}
.bigicon{width:70px;height:70px;border-radius:22px;background:#17171d;display:grid;place-items:center;font-size:30px;color:var(--accent);margin:0 auto 18px}
.row{display:flex;gap:14px;align-items:center}.between{justify-content:space-between}.wrap{flex-wrap:wrap}
.statsgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px}
.stat{padding:16px;border:1px solid var(--line);border-radius:16px;background:#111116}
.stat b{font:700 20px "Manrope";display:block}.stat span{font-size:12px;color:#777782}
.pipeline{display:grid;gap:10px;margin-top:18px}
.stageRow{display:grid;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:13px;padding:15px;border:1px solid var(--line);border-radius:16px;background:#101014}
.stageRow.active{border-color:rgba(255,45,125,.48);background:linear-gradient(90deg,rgba(255,45,125,.1),#101014)}
.stageRow.done{border-color:rgba(84,211,155,.2)}
.stageIndex{font:700 13px "Manrope";color:#777782}.stageRow.active .stageIndex{color:var(--accent)}
.stageStatus{font-size:12px;color:#777782}.stageRow.done .stageStatus{color:var(--success)}.stageRow.active .stageStatus{color:var(--accent)}
.progress{height:8px;border-radius:999px;background:#1b1b21;overflow:hidden;margin-top:18px}.progress span{display:block;height:100%;background:var(--accent);border-radius:999px}
.videoBox{aspect-ratio:16/9;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,#16161c,#09090c);display:grid;place-items:center;font-size:52px;color:#5f5f69}
.alert{padding:16px 18px;border-radius:16px;border:1px solid var(--line);margin-bottom:18px}
.alert.error{border-color:rgba(255,93,108,.38);background:rgba(255,93,108,.08);color:#ff9da8}
.alert.success{border-color:rgba(84,211,155,.3);background:rgba(84,211,155,.08);color:#a9efd0}
.historylist{display:grid;gap:12px}
.historyitem{display:grid;grid-template-columns:90px 1fr auto;gap:16px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:17px;background:#0f0f13}
.thumb{aspect-ratio:16/10;border-radius:12px;background:linear-gradient(145deg,#2c1621,#111116)}
.chip{display:inline-flex;padding:6px 9px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:#bdbdc4}
.adminGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.adminCard{padding:18px;border:1px solid var(--line);border-radius:17px;background:#0f0f13}
.adminCard b{display:block;font:800 28px "Manrope";margin-bottom:5px}
.adminTabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.adminTabs button{padding:9px 12px;border-radius:999px;border:1px solid var(--line);background:#0f0f13;color:#8e8e98}
.adminTabs button.active{background:white;color:#09090b;border-color:white}
.adminTable{display:grid;gap:10px}
.adminRow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,.8fr) auto;gap:12px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:15px;background:#0f0f13}
.adminRow small{color:var(--muted)}
.adminActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.statusDot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:var(--success)}
.statusDot.warn{background:var(--warning)}.statusDot.bad{background:var(--danger)}

.mobileNav{display:none}
.screenSwitcher{display:flex;gap:8px;flex-wrap:wrap}
.screenSwitcher button{padding:8px 11px;border-radius:999px;border:1px solid var(--line);background:#0f0f13;color:#9999a2;font-size:12px}
.screenSwitcher button.active{background:white;color:#09090b;border-color:white}
@media(max-width:850px){
  .shell{width:min(100% - 24px,1180px)}
  .navlinks{display:none}.actions .ghost{display:none}
  .topbar{height:64px}.topbarin{gap:10px}
  .brand{font-size:18px}.mark{width:31px;height:31px}
  .hero{padding:52px 0 36px}
  .hero h1{font-size:clamp(35px,10vw,52px);line-height:1.42;margin-top:20px}
  .hero p{font-size:15px;line-height:1.95}
  .heroactions{gap:10px}.heroactions .btn{width:100%}
  .preview{margin-top:38px;border-radius:22px}.window{border-radius:21px}
  .mockgrid{grid-template-columns:1fr}.mockside{display:none}.mockmain{padding:22px 16px}
  .mockmain h3{font-size:23px;line-height:1.5}
  .drop{min-height:220px;padding:18px}
  .grid3,.pricegrid{grid-template-columns:1fr}
  .steps{grid-template-columns:1fr}.step{border-right:0;border-bottom:1px solid var(--line);min-height:auto;padding:24px 18px}
  .section{padding:64px 0}.sectionhead{display:block}.sectionhead p{line-height:1.85}
  .card{min-height:auto;padding:22px}.card h3{margin-top:28px}
  .cta{padding:34px 18px;margin-bottom:70px}
  .workspaceApp{display:block}.sidebar{display:none}
  .mobileNav{display:flex;position:fixed;bottom:0;left:0;right:0;height:70px;background:rgba(9,9,12,.97);backdrop-filter:blur(16px);border-top:1px solid var(--line);z-index:50;justify-content:space-around;padding:7px 6px calc(7px + env(safe-area-inset-bottom))}
  .mobileNav button{background:transparent;border:0;color:#777782;font-size:10px;line-height:1.35;min-width:0;padding:4px}.mobileNav button.active{color:white}
  .appheader{height:62px;padding:0 14px}.appheader .brand{display:flex}
  .screenSwitcher{display:none}
  .apppage{padding:18px 12px 94px}
  .pagetitle{display:block;margin-bottom:18px}.pagetitle .btn,.pagetitle .chip{margin-top:12px}
  .panel{padding:17px 13px;border-radius:18px}
  .uploadpanel{min-height:310px}
  .statsgrid{grid-template-columns:1fr;gap:10px}
  .stageRow{grid-template-columns:36px minmax(0,1fr) 20px;gap:9px;padding:13px 10px}
  .stageRow b{font-size:13px;line-height:1.65}.stageStatus{line-height:1.6}
  .row{align-items:flex-start}.row.between{gap:12px}
  .historyitem{grid-template-columns:68px minmax(0,1fr);gap:11px;padding:11px}
  .historyitem>.btn{grid-column:1/-1;width:100%}
  .adminGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .adminCard{padding:14px}.adminCard b{font-size:22px}
  .adminTabs{overflow-x:auto;flex-wrap:nowrap;padding-bottom:5px}
  .adminTabs button{white-space:nowrap}
  .adminRow{grid-template-columns:1fr;gap:7px;padding:13px}
  .adminActions{justify-content:flex-start}.adminActions .btn{width:100%}
  .videoBox{font-size:42px}
}
`;

const pipeline = [
  "ဗီဒီယိုတင်ခြင်း",
  "အသံခွဲထုတ်ခြင်း",
  "စာသားထုတ်ခြင်း",
  "မြန်မာအသံဖန်တီးခြင်း",
  "Timeline ချိန်ညှိခြင်း",
  "ဇာတ်ဝင်ခန်းပြန်တည်ဆောက်ခြင်း",
  "Final Video ထုတ်ခြင်း",
];

function Brand() {
  return <div className="brand"><span className="mark" />Blink</div>;
}

function Landing({ onEnter }) {
  const [openFaq, setOpenFaq] = useState(0);
  return <div>
    <div className="topbar">
      <div className="shell topbarin">
        <Brand />
        <div className="navlinks">
          <a href="#features">လုပ်ဆောင်ချက်များ</a>
          <a href="#how">အသုံးပြုပုံ</a>
          <a href="#pricing">ဈေးနှုန်း</a>
          <a href="#faq">မေးလေ့ရှိသည်များ</a>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={onEnter}>အကောင့်ဝင်ရန်</button>
          <button className="btn primary" onClick={onEnter}>အခမဲ့စတင်မည်</button>
        </div>
      </div>
    </div>

    <section className="hero shell">
      <span className="badge"><i /> မြန်မာ Movie Recap Creator များအတွက်</span>
      <h1>Movie Recap Video ကို<br/><span>AI နဲ့ အလိုအလျောက်</span><br/>ဖန်တီးပါ</h1>
      <p>ဗီဒီယိုတင်ပါ။ မြန်မာအသံပါတဲ့ Recap Video ကို Blink က ဖန်တီးပေးပါမယ်။</p>
      <div className="heroactions">
        <button className="btn accent" onClick={onEnter}>အခမဲ့ စမ်းသုံးမည် →</button>
        <button className="btn">Demo ကြည့်မည် ▶</button>
      </div>
      <div className="trust">Credit card မလိုပါ · Google အကောင့်ဖြင့် စတင်နိုင်ပါသည်</div>

      <div className="preview">
        <div className="window">
          <div className="winbar"><span className="dot"/><span className="dot"/><span className="dot"/></div>
          <div className="mockgrid">
            <aside className="mockside"><div>New Recap</div><div>History</div><div>Plans & Credits</div><div>Settings</div></aside>
            <div className="mockmain">
              <div className="kicker">NEW RECAP</div>
              <h3>Recap အသစ်</h3>
              <p className="muted">မူရင်းဗီဒီယိုကို ရွေးချယ်တင်ပါ။</p>
              <div className="drop">
                <div><div className="bigicon">↑</div><b>ဗီဒီယိုကို ဒီနေရာမှာ တင်ပါ</b><p className="muted">MP4, MOV · အများဆုံး 2GB</p><button className="btn primary">ဗီဒီယိုရွေးမည်</button></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="section shell" id="features">
      <div className="sectionhead"><div><div className="kicker">WHY BLINK</div><h2>Content ဖန်တီးရာမှာ<br/>အချိန်ကို ပြန်ရယူပါ</h2></div><p>Recap ဖန်တီးဖို့လိုတာအားလုံးကို Workspace တစ်ခုထဲမှာ စုစည်းထားပါတယ်။</p></div>
      <div className="grid3">
        {[
          ["01","အချိန်ကုန်သက်သာမှု","Manual editing အဆင့်များစွာကို လျှော့ချပြီး Recap တစ်ပုဒ်ဖန်တီးချိန်ကို တိုစေပါတယ်။"],
          ["02","သဘာဝကျတဲ့ မြန်မာအသံ","ကြည့်ရှုသူနားထောင်ရအဆင်ပြေတဲ့ မြန်မာ narration အဖြစ် ဖန်တီးပေးပါတယ်။"],
          ["03","Download လုပ်ပြီး အသင့်သုံး","ပြီးဆုံးသွားတဲ့ MP4 Video ကို preview ကြည့်ပြီး တိုက်ရိုက် download လုပ်နိုင်ပါတယ်။"]
        ].map(x=><article className="card" key={x[0]}><span className="cardnum">{x[0]}</span><h3>{x[1]}</h3><p>{x[2]}</p></article>)}
      </div>
    </section>

    <section className="section shell" id="how">
      <div className="sectionhead"><div><div className="kicker">SIMPLE WORKFLOW</div><h2>သုံးဆင့်နဲ့ ပြီးပါပြီ</h2></div><p>ရှုပ်ထွေးတဲ့အဆင့်တွေကို Blink က တာဝန်ယူပါတယ်။</p></div>
      <div className="steps">
        <div className="step"><b>01</b><h3>ဗီဒီယိုတင်ပါ</h3><p>ဖန်တီးချင်တဲ့ မူရင်း Movie Video ကို Workspace ထဲတင်ပါ။</p></div>
        <div className="step"><b>02</b><h3>Blink ကို လုပ်ခိုင်းပါ</h3><p>Recap settings ကိုရွေးပြီး Generate လုပ်ပါ။ ကျန်တာအားလုံးကို AI က ဆောင်ရွက်ပါမယ်။</p></div>
        <div className="step"><b>03</b><h3>ကြည့်ပြီး Download လုပ်ပါ</h3><p>ပြီးဆုံးတဲ့ video ကို preview ကြည့်ပြီး MP4 အဖြစ် ရယူပါ။</p></div>
      </div>
    </section>

    <section className="section shell" id="pricing">
      <div className="sectionhead"><div><div className="kicker">PRICING</div><h2>သင့်အလုပ်နဲ့ ကိုက်ညီတဲ့ Plan</h2></div></div>
      <div className="pricegrid">
        <Price name="Free" price="$0" items={["စမ်းသပ် Recap ၁ ခု","Standard processing","MP4 Download"]}/>
        <Price hot name="Pro" price="$19" suffix="/လ" items={["Credits ပိုမိုရရှိခြင်း","Priority processing","History & downloads"]}/>
        <Price name="Studio" price="$49" suffix="/လ" items={["Credit ပမာဏမြင့်","Team workflow","Priority support"]}/>
      </div>
    </section>

    <section className="section shell" id="faq">
      <div className="sectionhead"><div><div className="kicker">FAQ</div><h2>မေးလေ့ရှိတာများ</h2></div></div>
      {[
        ["Blink က ဘာလုပ်ပေးတာလဲ။","Movie Video တစ်ခုကနေ မြန်မာအသံပါဝင်တဲ့ Recap Video အဖြစ် အလိုအလျောက်ဖန်တီးပေးပါတယ်။"],
        ["Final video ကို Download လုပ်လို့ရလား။","ရပါတယ်။ Processing ပြီးသွားတဲ့အခါ Preview ကြည့်နိုင်ပြီး MP4 အဖြစ် Download လုပ်နိုင်ပါတယ်။"],
        ["စတင်ဖို့ ဘာလိုအပ်လဲ။","Google အကောင့်တစ်ခုနဲ့ မူရင်းဗီဒီယိုတစ်ခုသာ လိုအပ်ပါတယ်။"]
      ].map((f,i)=><div className={`faqitem ${openFaq===i?"open":""}`} key={f[0]}><button className="faqbtn" onClick={()=>setOpenFaq(openFaq===i?-1:i)}>{f[0]}<span>+</span></button><div className="faqans">{f[1]}</div></div>)}
    </section>

    <section className="shell cta"><h2>နောက် Recap ကို Blink နဲ့ စတင်ပါ</h2><p className="muted">အချိန်ကုန်သက်သာပြီး ပိုမိုမြန်ဆန်တဲ့ AI Production Workflow ကို စမ်းသုံးကြည့်ပါ။</p><button className="btn accent" onClick={onEnter}>Google ဖြင့် အခမဲ့စတင်မည်</button></section>
    <footer><div className="shell row between wrap"><Brand/><div>© 2026 Blink Automation · Privacy · Terms</div></div></footer>
  </div>
}

function Price({name,price,suffix="",items,hot=false}) {
  return <div className={`price ${hot?"hot":""}`}>{hot&&<span className="flag">အသင့်တော်ဆုံး</span>}<small>{hot?"Creator များအတွက်":"စတင်ရန်"}</small><h3>{name}</h3><div className="money">{price}<span>{suffix}</span></div><ul>{items.map(x=><li key={x}>{x}</li>)}</ul><button className={`btn ${hot?"accent":""}`} style={{width:"100%"}}>{hot?"Pro ကိုရွေးမည်":"ရွေးချယ်မည်"}</button></div>
}

function Workspace({ onExit }) {
  const [screen,setScreen] = useState("new");
  const [processState,setProcessState] = useState("idle");
  const nav = [
    ["new","New Recap"],["history","History"],["plans","Plans & Credits"],["admin","Super Admin"]
  ];

  const content = useMemo(()=>{
    if(screen==="new"){
      if(processState==="idle") return <NewRecap onStart={()=>setProcessState("processing")}/>;
      if(processState==="processing") return <Processing onComplete={()=>setProcessState("completed")} onFail={()=>setProcessState("error")}/>;
      if(processState==="completed") return <Completed onAgain={()=>setProcessState("idle")}/>;
      return <ErrorState onRetry={()=>setProcessState("processing")} onCancel={()=>setProcessState("idle")}/>;
    }
    if(screen==="history") return <History />;
    if(screen==="plans") return <Plans />;
    return <Admin />;
  },[screen,processState]);

  return <div className="workspaceApp">
    <aside className="sidebar">
      <div className="sidebrand"><Brand/></div>
      <div className="sidenav">{nav.map(n=><button key={n[0]} className={screen===n[0]?"active":""} onClick={()=>setScreen(n[0])}>{n[1]}</button>)}</div>
      <div className="sidebottom"><div className="creditbox"><small className="muted">လက်ကျန် Credits</small><div className="row between"><b>12 Credits</b><span className="chip">Pro</span></div></div><button className="btn ghost" style={{width:"100%",marginTop:10}} onClick={onExit}>Logout</button></div>
    </aside>
    <div className="mainarea">
      <header className="appheader"><Brand/><div className="screenSwitcher">{[["idle","Idle"],["processing","Processing"],["completed","Completed"],["error","Error"]].map(s=><button key={s[0]} className={processState===s[0]?"active":""} onClick={()=>{setScreen("new");setProcessState(s[0])}}>{s[1]}</button>)}</div></header>
      <main className="apppage">{content}</main>
    </div>
    <nav className="mobileNav">{nav.slice(0,3).map(n=><button key={n[0]} className={screen===n[0]?"active":""} onClick={()=>setScreen(n[0])}>{n[1]}</button>)}</nav>
  </div>
}

function NewRecap({onStart}) {
  return <>
    <div className="pagetitle"><div><div className="kicker">NEW RECAP</div><h1>Recap အသစ်</h1><p>ဗီဒီယိုတင်ပြီး စတင်ပါ။</p></div><span className="chip">12 Credits</span></div>
    <div className="panel uploadpanel"><div><div className="bigicon">↑</div><h2>ဗီဒီယိုကို ဒီနေရာမှာ တင်ပါ</h2><p className="muted">MP4, MOV · အများဆုံး 2GB</p><button className="btn primary">ဗီဒီယိုရွေးမည်</button></div></div>
    <div className="statsgrid"><div className="stat"><b>15 မိနစ်</b><span>Recap အရှည်</span></div><div className="stat"><b>မြန်မာ</b><span>အဓိကဘာသာစကား</span></div><div className="stat"><b>1 Credit</b><span>ခန့်မှန်းအသုံးပြုမှု</span></div></div>
    <div className="panel" style={{marginTop:16}}><div className="row between wrap"><div><h3 style={{margin:"0 0 6px"}}>Movie_Example.mp4</h3><span className="muted">1.4 GB · 01:42:18</span></div><button className="btn accent" onClick={onStart}>Recap စတင်ဖန်တီးမည် →</button></div></div>
  </>
}

function Processing({onComplete,onFail}) {
  return <>
    <div className="pagetitle"><div><div className="kicker">PROCESSING</div><h1>ဖန်တီးနေသည်</h1><p>Processing ကို ဆက်လုပ်နေပါမယ်။</p></div><span className="chip">42%</span></div>
    <div className="panel">
      <div className="row between"><b>Movie_Example.mp4</b><span className="muted">12:08 elapsed</span></div>
      <div className="progress"><span style={{width:"42%"}}/></div>
      <div className="pipeline">{pipeline.map((p,i)=><div className={`stageRow ${i<2?"done":i===2?"active":""}`} key={p}><span className="stageIndex">0{i+1}</span><div><b>{p}</b><div className="stageStatus">{i<2?"ပြီးဆုံးပါပြီ":i===2?"လုပ်ဆောင်နေသည်":"စောင့်ဆိုင်းနေသည်"}</div></div><span>{i<2?"✓":i===2?"●":"—"}</span></div>)}</div>
      <div className="row wrap" style={{marginTop:18}}><button className="btn primary" onClick={onComplete}>Completed state ကြည့်မည်</button><button className="btn danger" onClick={onFail}>Error state ကြည့်မည်</button></div>
    </div>
  </>
}

function Completed({onAgain}) {
  return <>
    <div className="pagetitle"><div><div className="kicker">COMPLETED</div><h1>Video အသင့်ဖြစ်ပါပြီ</h1><p>Preview ကြည့်ပြီး MP4 ကို Download လုပ်နိုင်ပါတယ်။</p></div><span className="chip">46.7 sec</span></div>
    <div className="alert success">✓ Final MP4 ကို အောင်မြင်စွာ ဖန်တီးပြီးပါပြီ။</div>
    <div className="panel"><div className="videoBox">▶</div><div className="row between wrap" style={{marginTop:18}}><div><b>Movie_Example_Recap.mp4</b><div className="muted">H.264 + AAC · 8.1 MB</div></div><div className="row wrap"><button className="btn">Preview</button><button className="btn accent">Download Video</button></div></div></div>
    <button className="btn" style={{marginTop:16}} onClick={onAgain}>နောက်တစ်ပုဒ် ဖန်တီးမည်</button>
  </>
}

function ErrorState({onRetry,onCancel}) {
  return <>
    <div className="pagetitle"><div><div className="kicker">FAILED</div><h1>Processing မပြီးဆုံးနိုင်ခဲ့ပါ</h1><p>မအောင်မြင်တဲ့အဆင့်ကနေ ပြန်စနိုင်ပါတယ်။</p></div></div>
    <div className="alert error"><b>Gemini translation request failed</b><div style={{marginTop:6}}>Quota သို့မဟုတ် model error ဖြစ်နိုင်ပါတယ်။ Earlier artifacts များကို ထိန်းသိမ်းထားပါတယ်။</div></div>
    <div className="panel"><div className="pipeline">{pipeline.map((p,i)=><div className={`stageRow ${i<2?"done":i===2?"active":""}`} key={p}><span className="stageIndex">0{i+1}</span><div><b>{p}</b><div className="stageStatus">{i<2?"Validated artifact ရှိသည်":i===2?"ဒီအဆင့်မှာ error ဖြစ်သည်":"မစတင်ရသေး"}</div></div><span>{i<2?"✓":i===2?"!":"—"}</span></div>)}</div><div className="row wrap" style={{marginTop:18}}><button className="btn accent" onClick={onRetry}>မအောင်မြင်သည့်အဆင့်မှ Retry</button><button className="btn" onClick={onCancel}>Cancel</button></div></div>
  </>
}

function History() {
  const jobs=[["Completed","The Last Kingdom Recap","Today · 46.7 sec"],["Processing","Dune Recap","Today · 42%"],["Failed","Crime Story Recap","Yesterday · Translate stage"]];
  return <><div className="pagetitle"><div><div className="kicker">HISTORY</div><h1>ယခင် Recap များ</h1><p>ပြီးဆုံး၊ လုပ်ဆောင်နေဆဲနဲ့ မအောင်မြင်သေးတဲ့အလုပ်တွေကို ကြည့်နိုင်ပါတယ်။</p></div></div><div className="historylist">{jobs.map(j=><div className="historyitem" key={j[1]}><div className="thumb"/><div><b>{j[1]}</b><div className="muted">{j[2]}</div><span className="chip" style={{marginTop:8}}>{j[0]}</span></div><button className="btn">Open</button></div>)}</div></>
}

function Plans() {
  return <><div className="pagetitle"><div><div className="kicker">PLANS & CREDITS</div><h1>Plan နဲ့ Credits</h1><p>Pro plan က billing plan ဖြစ်ပြီး Admin role မဟုတ်ပါ။</p></div><span className="chip">Current: Pro</span></div><div className="pricegrid"><Price name="Free" price="$0" items={["စမ်းသပ် Credit","Standard processing","Community support"]}/><Price hot name="Pro" price="$19" suffix="/လ" items={["Credits ပိုမိုရရှိခြင်း","Priority processing","History & downloads"]}/><Price name="Studio" price="$49" suffix="/လ" items={["Credit ပမာဏမြင့်","Team support","Priority assistance"]}/></div></>
}

function Admin() {
  const [tab,setTab]=useState("overview");
  const tabs=[
    ["overview","Overview"],["users","Users"],["purchases","Purchases"],
    ["packages","Packages"],["credits","Credits"],["audit","Audit Log"],["status","System Status"]
  ];
  const users=[
    ["Moe Thura","moe@example.com","Pro","Active"],
    ["Su Su","susu@example.com","Free","Active"],
    ["Aung Min","aung@example.com","Pro","Suspended"],
  ];
  const purchases=[
    ["INV-1042","Moe Thura","1,000 Credits","Pending"],
    ["INV-1041","Su Su","300 Credits","Verified"],
  ];
  const packages=[
    ["Free","1 Credit","Active"],["Pro","50 Credits","Active"],["Studio","150 Credits","Draft"]
  ];

  return <>
    <div className="pagetitle">
      <div><div className="kicker">SUPER ADMIN</div><h1>System Management</h1><p>Users, payments, packages နဲ့ system operations ကို စီမံပါ။</p></div>
      <span className="chip">super_admin</span>
    </div>

    <div className="adminTabs">
      {tabs.map(t=><button key={t[0]} className={tab===t[0]?"active":""} onClick={()=>setTab(t[0])}>{t[1]}</button>)}
    </div>

    {tab==="overview"&&<>
      <div className="adminGrid">
        <div className="adminCard"><b>1,284</b><span className="muted">Users</span></div>
        <div className="adminCard"><b>392</b><span className="muted">Active jobs</span></div>
        <div className="adminCard"><b>18</b><span className="muted">Failed jobs</span></div>
        <div className="adminCard"><b>99.3%</b><span className="muted">Uptime</span></div>
      </div>
      <div className="panel" style={{marginTop:16}}>
        <h3>Recent Activity</h3>
        <div className="historylist" style={{marginTop:14}}>
          {["Pro package updated","Credits added to Moe Thura","Failed job retried"].map((x,i)=><div className="historyitem" key={x}><div className="thumb"/><div><b>{x}</b><div className="muted">{i+1} hour ago · admin@blink.ai</div></div><span className="chip">Audit</span></div>)}
        </div>
      </div>
    </>}

    {tab==="users"&&<div className="panel"><div className="adminTable">
      {users.map(u=><div className="adminRow" key={u[1]}><div><b>{u[0]}</b><small>{u[1]}</small></div><span>{u[2]}</span><span><i className={`statusDot ${u[3]==="Suspended"?"bad":""}`}/>{u[3]}</span><div className="adminActions"><button className="btn">View</button><button className="btn danger">Suspend</button></div></div>)}
    </div></div>}

    {tab==="purchases"&&<div className="panel"><div className="adminTable">
      {purchases.map(p=><div className="adminRow" key={p[0]}><div><b>{p[0]}</b><small>{p[1]}</small></div><span>{p[2]}</span><span><i className={`statusDot ${p[3]==="Pending"?"warn":""}`}/>{p[3]}</span><div className="adminActions"><button className="btn accent">Verify & Add</button><button className="btn">Proof</button></div></div>)}
    </div></div>}

    {tab==="packages"&&<div className="panel"><div className="row between wrap" style={{marginBottom:14}}><h3 style={{margin:0}}>Packages</h3><button className="btn accent">Create Package</button></div><div className="adminTable">
      {packages.map(p=><div className="adminRow" key={p[0]}><div><b>{p[0]}</b><small>{p[1]}</small></div><span>{p[2]}</span><span>Order controls</span><div className="adminActions"><button className="btn">Edit</button><button className="btn">Reorder</button><button className="btn danger">Archive</button></div></div>)}
    </div></div>}

    {tab==="credits"&&<div className="panel"><h3>Credit Adjustment</h3><p className="muted">User ကိုရွေးပြီး credits ထည့်ခြင်း သို့မဟုတ် နုတ်ခြင်းလုပ်နိုင်ပါတယ်။</p><div className="statsgrid"><div className="stat"><b>User</b><span>moe@example.com</span></div><div className="stat"><b>Amount</b><span>500 Credits</span></div><div className="stat"><b>Action</b><span>Add</span></div></div><button className="btn accent" style={{marginTop:16}}>Apply Adjustment</button></div>}

    {tab==="audit"&&<div className="panel"><div className="historylist">
      {["Package Pro updated","Purchase INV-1042 verified","User suspended","500 credits added"].map((x,i)=><div className="historyitem" key={x}><div className="thumb"/><div><b>{x}</b><div className="muted">admin@blink.ai · {i+1}h ago</div></div><span className="chip">Logged</span></div>)}
    </div></div>}

    {tab==="status"&&<div className="panel"><div className="adminTable">
      {[["API","Operational",""],["Worker Queue","Operational",""],["Gemini","Degraded","warn"],["Storage","Operational",""]].map(s=><div className="adminRow" key={s[0]}><b>{s[0]}</b><span><i className={`statusDot ${s[2]}`}/>{s[1]}</span><span>Updated now</span><div className="adminActions"><button className="btn">Inspect</button></div></div>)}
    </div></div>}
  </>
}

export default function BlinkAutomation() {
  const [entered,setEntered]=useState(false);
  return <div className="app"><style>{styles}</style>{entered?<Workspace onExit={()=>setEntered(false)}/>:<Landing onEnter={()=>setEntered(true)}/>}</div>;
}
