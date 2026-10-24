/** The page's stylesheet: light and dark by variables, no font, no image, final state in print and under reduced motion. */
export const PAGE_CSS = `:root{--bg:#fbfbfa;--fg:#1c1d1f;--mut:#5b6068;--line:#c9ccd2;--card:#fff;--acc:#0b5cd5;--ok:#17703a;--warn:#8a5a00;--bad:#b3261e;--info:#0b5cd5;--add:#17703a;--rem:#b3261e;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15171a;--fg:#e8e9eb;--mut:#a3a8b0;--line:#3a3f47;--card:#1e2126;--acc:#6ea8ff;--ok:#5fd18a;--warn:#f0b955;--bad:#ff8a80;--info:#6ea8ff;--add:#5fd18a;--rem:#ff8a80;color-scheme:dark}}
:root[data-theme=dark]{--bg:#15171a;--fg:#e8e9eb;--mut:#a3a8b0;--line:#3a3f47;--card:#1e2126;--acc:#6ea8ff;--ok:#5fd18a;--warn:#f0b955;--bad:#ff8a80;--info:#6ea8ff;--add:#5fd18a;--rem:#ff8a80;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
h1{font-size:1.6rem;line-height:1.25;margin:0;flex:1 1 320px}
h2{font-size:1.15rem;margin:32px 0 8px}
.meta{color:var(--mut);font-size:.9rem;display:flex;flex-wrap:wrap;gap:4px 16px;margin:4px 0 0}
.chip{display:inline-flex;align-items:center;gap:8px;border:2px solid currentColor;border-radius:999px;padding:2px 12px;font-weight:600;font-size:.9rem}
.chip i{display:inline-block;width:12px;height:12px;background:currentColor}
.ok{color:var(--ok)}.ok i{border-radius:50%}
.warn{color:var(--warn)}.warn i{clip-path:polygon(50% 0,100% 100%,0 100%)}
.blocked{color:var(--bad)}.blocked i{border-radius:2px}
.info{color:var(--info)}.info i{transform:rotate(45deg) scale(.8)}
button{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 12px;cursor:pointer}
button:focus-visible,.node:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.verdict{font-size:1.25rem;font-weight:600;margin:16px 0 4px}
.cap{color:var(--mut);margin:0 0 12px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:16px 0}
.strip div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.strip b{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.fig{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}
svg{display:block;max-width:none;color:var(--mut)}
.node rect{fill:var(--bg);stroke:var(--fg);stroke-width:1.5}
.node .t{font-size:14px;font-weight:600;fill:var(--fg)}.node .s{font-size:12px;fill:var(--mut)}
.node.service rect{stroke-width:3}.node.store rect{stroke-dasharray:2 3;stroke-width:2.5}.node.actor rect{rx:32}.node.external rect{stroke-dasharray:8 4}
.edge path{fill:none;stroke:currentColor;stroke-width:1.8}.edge text{font-size:12px;fill:var(--fg);paint-order:stroke;stroke:var(--card);stroke-width:4px}
.edge.branch path,.edge.return path{stroke-dasharray:7 5}.edge.fanout path{stroke-width:2.6}.edge.error{color:var(--bad)}.edge.error path{stroke:var(--bad)}marker .bad{fill:var(--bad)}.edge.error path{stroke-dasharray:2 4}
.flow .edge path{stroke-dasharray:6 6;animation:dash 1s linear infinite}
@keyframes dash{to{stroke-dashoffset:-12}}
.focus .node:not(.on),.focus .edge:not(.on){opacity:.22}
#detail,#stepnote{min-height:1.5em;margin:8px 0 0}
#stepnote{font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--mut);font-size:.85rem;margin:8px 0 0}
.steps{margin:12px 0 0;padding-left:24px}
.ba{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.ba section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 16px}
.ba h3{margin:4px 0}.ba ul{margin:0;padding-left:20px}
.added{color:var(--add);font-weight:600}.removed{color:var(--rem);text-decoration:line-through dashed}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:560px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:6px 10px}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.tag{font-weight:600;white-space:nowrap}
ol.d{padding-left:24px}ol.d li{margin:8px 0}
a{color:var(--acc)}
.present{font-size:1.2em}.present .bar,.present #theme{display:none}
@media (prefers-reduced-motion:reduce){.flow .edge path{animation:none}}
@media print{body{background:#fff;color:#000}.bar,#theme{display:none}.fig{overflow:visible}.flow .edge path{animation:none}.focus .node:not(.on),.focus .edge:not(.on){opacity:1}}`;

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
