import { VisualizeLimits } from './constants.ts';
import { FIGURE_FIT, figureWidth } from './layout.ts';

/** Light and dark palettes: neutral ink with one bronze accent; the page is not a product, so no product colour. */
const LIGHT =
  '--bg:#fafaf8;--soft:#f2f1ed;--card:#fff;--fg:#16171a;--mut:#5a5f68;--line:#d8dadf;--acc:#8d5f10;--ok:#17703a;--warn:#8a5a00;--bad:#b3261e;--info:#0b5cd5;--add:#17703a;--rem:#b3261e;--add-bg:#e8f4ec;--rem-bg:#fbeceb;color-scheme:light';
const DARK =
  '--bg:#121214;--soft:#17181b;--card:#1a1b1f;--fg:#ececee;--mut:#a0a4ad;--line:#2c2f36;--acc:#dead6a;--ok:#5fd18a;--warn:#f0b955;--bad:#ff8a80;--info:#6ea8ff;--add:#5fd18a;--rem:#ff8a80;--add-bg:#16251c;--rem-bg:#2a1b1a;color-scheme:dark';

/**
 * Below the viewport width at which a figure of N columns would shrink under FIGURE_FIT of its natural size
 * (text under 12 px), the figure gives way to a list. The 66 is the page and frame padding.
 */
const figureFit = Array.from({ length: VisualizeLimits.MAX_GRID }, (_, index) => {
  const cols = index + 1;
  const width = Math.ceil(figureWidth({ cols }) * FIGURE_FIT) + 66;

  return `@media (max-width:${width}px){.fig.c${cols}{display:none}.fig.c${cols}~.path,.fig.c${cols}~.path-detail{display:block}.fig.c${cols}~.bar,.fig.c${cols}~#detail,.fig.c${cols}~.legend{display:none}}`;
}).join('\n');

/** The page's stylesheet: light and dark by variables, system fonts, no image, final state in print and under reduced motion. */
export const PAGE_CSS = `:root{${LIGHT};--sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:24px 20px 72px}
.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.meta{font:500 .8125rem/1.5 var(--mono);color:var(--mut);letter-spacing:.03em;display:flex;flex-wrap:wrap;gap:2px 16px;margin:0}
.tools{display:flex;gap:8px;align-items:center}
h1{font-size:clamp(1.6rem,1.15rem + 1.9vw,2.4rem);line-height:1.12;letter-spacing:-.02em;font-weight:700;margin:22px 0 0;max-width:36ch;text-wrap:balance}
.verdict{font-size:1.25rem;line-height:1.4;font-weight:500;max-width:58ch;margin:16px 0 0}
.cap{color:var(--mut);margin:8px 0 0;max-width:70ch}
.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid currentColor;border-radius:4px;padding:3px 10px;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.06em}
.chip i,.st i{display:inline-block;width:10px;height:10px;background:currentColor;flex:none}
.ok{color:var(--ok)}.ok i{border-radius:50%}
.warn{color:var(--warn)}.warn i{clip-path:polygon(50% 0,100% 100%,0 100%)}
.blocked{color:var(--bad)}.blocked i{border-radius:2px}
.info{color:var(--info)}.info i{transform:rotate(45deg) scale(.8)}
button{font:500 .8125rem/1.3 var(--mono);letter-spacing:.04em;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:4px;padding:5px 10px;cursor:pointer}
button:hover{border-color:var(--fg)}
button:focus-visible,.node:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
h2{display:flex;align-items:center;gap:12px;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin:48px 0 14px}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
.lab{display:block;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:0}
.owner{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;margin:28px 0 0}
.owner>div{border:1px solid var(--line);border-radius:4px;background:var(--card);padding:16px 18px}
.owner .need{border:1.5px solid var(--fg)}
.need .lab{color:var(--acc)}
.owner p{margin:8px 0 0}
.need p{font-size:1.15rem;line-height:1.4;font-weight:500}
.need a{display:inline-block;margin-top:10px;font:600 .8125rem/1.3 var(--mono);letter-spacing:.04em;color:var(--fg)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px 32px;margin:22px 0 0}
.facts p{margin:4px 0 0;max-width:60ch}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th{font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);text-align:left;padding:0 14px 8px 0;border-bottom:1px solid var(--fg)}
td{text-align:left;vertical-align:top;border-top:1px solid var(--line);padding:11px 14px 11px 0}
tbody tr:first-child td{border-top:0}
.map{max-width:640px}
.tag{font:600 .8125rem/1.5 var(--mono);white-space:nowrap;color:var(--mut)}
.st{display:inline-flex;align-items:center;gap:8px;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.st.done{color:var(--ok)}.st.done i{border-radius:1px}
.st.in-progress{color:var(--info)}.st.in-progress i{background:linear-gradient(90deg,currentColor 50%,transparent 50%);border:1.5px solid currentColor}
.st.waiting{color:var(--warn)}.st.waiting i{background:none;border:1.5px solid currentColor;border-radius:50%}
.st.not-started{color:var(--mut)}.st.not-started i{background:none;border:1.5px dotted currentColor}
.st.blocked{color:var(--bad)}.st.blocked i{transform:rotate(45deg) scale(.85)}
.st.dropped{color:var(--mut)}.st.dropped i{height:2px;margin:4px 0}
.ev{display:inline-block;border:1px solid currentColor;border-radius:4px;padding:1px 8px;font:600 .8125rem/1.4 var(--mono);letter-spacing:.04em}
.ev.verified{color:var(--ok)}.ev.inferred{color:var(--warn);border-style:dashed}.ev.guess{color:var(--mut);border-style:dotted}
.fig{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:4px;padding:12px}
svg{display:block;max-width:100%;height:auto;color:var(--mut)}
.node rect{fill:var(--card);stroke:var(--fg);stroke-width:1.25}
.node .t{font:600 15px var(--sans);fill:var(--fg)}.node .s{font:13px var(--mono);fill:var(--mut)}
.node.service rect{stroke-width:3}.node.store rect{stroke-dasharray:2 3;stroke-width:2.25}.node.actor rect{rx:30}.node.external rect{stroke-dasharray:8 4}
.edge path{fill:none;stroke:currentColor;stroke-width:1.6}.edge text{font:13px var(--mono);fill:var(--fg);paint-order:stroke;stroke:var(--card);stroke-width:5px}
.edge.branch path,.edge.return path{stroke-dasharray:7 5}.edge.fanout path{stroke-width:2.6}.edge.error{color:var(--bad)}.edge.error path{stroke:var(--bad)}marker .bad{fill:var(--bad)}.edge.error path{stroke-dasharray:2 4}
.flow .edge path{stroke-dasharray:6 6;animation:dash 1s linear infinite}
@keyframes dash{to{stroke-dashoffset:-12}}
.focus .node:not(.on),.focus .edge:not(.on){opacity:.22}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 0}
#detail,#stepnote{min-height:1.5em;margin:10px 0 0;color:var(--mut)}
#stepnote{color:var(--fg);font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--mut);font:.8125rem/1.4 var(--mono);margin:12px 0 0}
.steps{margin:14px 0 0;padding-left:24px;max-width:70ch}
.path,.path-detail{display:none;list-style:none;margin:0;padding:0}
.path li,.path-detail li{border-top:1px solid var(--line);padding:10px 0}
.path li:first-child{border-top:0}
.path b{font-weight:600}
.verb{display:inline-block;margin:0 10px;border:1px solid var(--line);border-radius:4px;padding:0 8px;font:.8125rem/1.6 var(--mono);color:var(--mut)}
.verb.error{color:var(--bad);border-color:var(--bad)}.verb.branch,.verb.return{border-style:dashed}
.path-detail{margin-top:12px}
.path-detail b{display:block}
.ba{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.ba section{border:1px solid var(--line);border-radius:4px;background:var(--card)}
.ba h3{margin:0;padding:12px 18px}
.ba ul{list-style:none;margin:0;padding:0}
.ba li{display:flex;gap:12px;padding:10px 18px;border-top:1px solid var(--line)}
.ba li::before{content:"";flex:none;width:1ch;font:600 1rem/1.55 var(--mono)}
.ba li.added{background:var(--add-bg)}.ba li.added::before{content:"+";color:var(--add)}
.ba li.removed{background:var(--rem-bg)}.ba li.removed::before{content:"-";color:var(--rem)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dec{list-style:none;margin:0;padding:0;display:grid;gap:12px;counter-reset:d}
.dec li{counter-increment:d;position:relative;border:1px solid var(--line);border-radius:4px;background:var(--card);padding:16px 18px 18px 54px}
.dec li::before{content:counter(d);position:absolute;left:18px;top:19px;font:600 .8125rem/1.3 var(--mono);color:var(--mut)}
.dec li{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:6px 28px;align-items:start}
.q{grid-column:1;font-size:1.1rem;line-height:1.4;font-weight:600;margin:0}
.rec{grid-column:2;grid-row:1 / span 2;margin:0;padding:10px 14px;border:1px solid var(--acc);border-radius:4px}
.rec .lab{color:var(--acc)}.rec p{margin:4px 0 0;font-weight:500}
.chg{grid-column:1;margin:4px 0 0;color:var(--mut);font-size:.9375rem}
.chg .lab{display:inline;margin-right:8px}
a{color:var(--fg);text-underline-offset:3px}
.links{list-style:none;margin:0;padding:0;display:grid;gap:6px}
footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);font:.8125rem/1.5 var(--mono);color:var(--mut)}
.present{font-size:1.2em}.present .bar,.present #theme{display:none}
@media (max-width:760px){main{padding:16px 16px 56px}.owner{grid-template-columns:1fr}h2{margin-top:40px}
.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.stack,.stack tbody,.stack tr,.stack td{display:block;width:100%}
.stack tr{padding:12px 0;border-top:1px solid var(--line)}.stack tbody tr:first-child{border-top:0;padding-top:0}
.stack td{border:0;padding:3px 0}
.stack td[data-label]::before{content:attr(data-label);display:block;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin-bottom:2px}
.dec li{padding-left:18px;display:block}.dec li::before{position:static;display:block;margin-bottom:6px}.rec{margin:12px 0 0}}
${figureFit}
@media (prefers-reduced-motion:reduce){.flow .edge path{animation:none}}
@media print{body{background:#fff;color:#000}.bar,#theme{display:none}.fig{overflow:visible;display:block!important}.path,.path-detail{display:none!important}.flow .edge path{animation:none}.focus .node:not(.on),.focus .edge:not(.on){opacity:1}}`;

/** The page's script: theme, detail on hover or focus, play and pause, numbered steps. Text is set with textContent only. */
export const PAGE_JS = `(()=>{
const d=document,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>[...r.querySelectorAll(s)],root=d.documentElement;
try{const t=localStorage.getItem('vz-theme');if(t==='dark'||t==='light')root.dataset.theme=t}catch(e){}
const tb=q('#theme');
if(tb)tb.onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches,n=dark?'light':'dark';root.dataset.theme=n;try{localStorage.setItem('vz-theme',n)}catch(e){}};
if(new URLSearchParams(location.search).get('present')==='1')root.classList.add('present');
const fig=q('.fig'),panel=q('#detail');
qa('[data-node]').forEach(n=>{const show=()=>{if(panel)panel.textContent=n.dataset.detail};n.addEventListener('mouseenter',show);n.addEventListener('focus',show)});
const pp=q('#play');
if(pp&&fig)pp.onclick=()=>{const on=fig.classList.toggle('flow');pp.textContent=on?pp.dataset.pause:pp.dataset.play;pp.setAttribute('aria-pressed',String(on))};
const raw=q('#steps');
if(raw&&fig){
const steps=JSON.parse(raw.textContent),note=q('#stepnote'),prev=q('#prev'),next=q('#next'),all=q('#all');
let at=-1;
const show=i=>{at=i;qa('.on',fig).forEach(x=>x.classList.remove('on'));
if(i<0){fig.classList.remove('focus');note.textContent='';return}
const s=steps[i];fig.classList.add('focus');
s.nodes.forEach(id=>q('[data-node="'+id+'"]',fig)?.classList.add('on'));
s.edges.forEach(id=>q('[data-edge="'+id+'"]',fig)?.classList.add('on'));
note.textContent=(i+1)+'/'+steps.length+'  '+s.title+' - '+s.note};
if(prev)prev.onclick=()=>show(Math.max(0,at-1));
if(next)next.onclick=()=>show(Math.min(steps.length-1,at+1));
if(all)all.onclick=()=>show(-1);
}
})();`;
