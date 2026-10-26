/** Light and dark palettes: neutral ink, one bronze accent, semantic states with tints, five series colours for charts. */
const LIGHT =
  '--bg:#f4f4f4;--surface:#fff;--surface2:#ececec;--fg:#15161a;--mut:#585d66;--line:#dedede;--acc:#98681a;--acc-bg:#f6ecd9;--ok:#157a3a;--ok-bg:#e4f3e8;--warn:#9c5a06;--warn-bg:#fcefd8;--bad:#bd2820;--bad-bg:#fbe8e6;--info:#1c5ccc;--info-bg:#e6edfb;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--shadow:0 1px 2px rgba(20,22,30,.06);color-scheme:light';
const DARK =
  '--bg:#0e0f12;--surface:#17191e;--surface2:#1d2026;--fg:#eeeef0;--mut:#a2a6af;--line:#2a2d35;--acc:#e0b366;--acc-bg:#2b2314;--ok:#5fd18a;--ok-bg:#13261b;--warn:#f0b955;--warn-bg:#2b2212;--bad:#ff8a80;--bad-bg:#2d1816;--info:#7ab0ff;--info-bg:#14213a;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--shadow:0 1px 2px rgba(0,0,0,.4);color-scheme:dark';

/** The page's stylesheet: light and dark by variables, system fonts, no image, final state in print and under reduced motion. */
export const PAGE_CSS = `:root{${LIGHT};--sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--serif:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 var(--sans);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
h1,h2,h3,p,ol,ul,figure,blockquote{margin:0}
ol,ul{padding:0;list-style:none}
a{color:inherit;text-underline-offset:3px}
.ic{flex:none;display:inline-block;vertical-align:middle}
.c-ok{--c:var(--ok);--cb:var(--ok-bg)}.c-warn{--c:var(--warn);--cb:var(--warn-bg)}.c-bad{--c:var(--bad);--cb:var(--bad-bg)}.c-info{--c:var(--info);--cb:var(--info-bg)}.c-mut{--c:var(--mut);--cb:var(--surface2)}
.chip{display:inline-flex;align-items:center;gap:6px;color:var(--c);font:600 .8125rem/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em}
.lab{font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.mut{color:var(--mut)}.inl{display:inline-flex;margin-right:6px;color:var(--c)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
button{font:500 .8125rem/1.3 var(--mono);letter-spacing:.04em;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:4px;padding:5px 10px;cursor:pointer}
button:hover{border-color:var(--fg)}
.wrap{max-width:1240px;margin:0 auto;padding:16px 20px 72px}
.tools{display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px}
.mini{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;padding:0 20px;background:var(--bg);border-bottom:1px solid transparent;opacity:0;pointer-events:none;height:0;overflow:hidden;transition:opacity .2s}
.mini.on{opacity:1;pointer-events:auto;height:auto;padding:8px 20px;border-bottom-color:var(--line)}
.mini b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-size:.9375rem}
.banner{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;padding:30px 32px;border-radius:4px;background:var(--cb);border:1px solid color-mix(in srgb,var(--c) 40%,var(--surface));box-shadow:var(--shadow)}
.b-ic{color:var(--c);display:grid;place-items:center;width:84px;height:84px;border-radius:4px;background:var(--surface)}
.b-ic .ic{width:52px;height:52px}
.meta{display:flex;flex-wrap:wrap;gap:2px 16px;font:500 .8125rem/1.4 var(--mono);color:var(--mut);letter-spacing:.03em}
.word{font:800 clamp(1.8rem,1.2rem + 2.6vw,3rem)/1 var(--sans);letter-spacing:-.02em;text-transform:uppercase;color:var(--c);margin:10px 0 8px}
h1{font-size:clamp(1.3rem,1.1rem + .8vw,1.6rem);line-height:1.25;font-weight:650;max-width:62ch}
.verdict{margin-top:8px;font-size:1.05rem;max-width:62ch}
.cap{margin-top:6px;color:var(--mut);max-width:62ch}
.sec{margin-top:40px}
.sec>h2.lab{margin-bottom:14px}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}
.tile{padding:18px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow);position:relative;display:grid;gap:8px}
.tile .n{font:750 2.4rem/1 var(--sans);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.tile .l{color:var(--mut);font-size:.9375rem}
.tile .ic{position:absolute;top:16px;right:16px;color:var(--c)}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px}
.seg{display:grid;gap:8px;align-content:start}
.seg .bar{height:10px;border-radius:4px;background:var(--c)}
.seg.c-mut .bar{background:repeating-linear-gradient(135deg,var(--line) 0 5px,transparent 5px 10px);border:1px solid var(--line)}
.seg .nm{display:grid;gap:3px;font-size:.9375rem;line-height:1.3}.seg .tn{font-weight:600}
.seg .nt{color:var(--mut);font-size:.875rem;line-height:1.35}
.two{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;margin-top:28px;align-items:start}
.card{padding:22px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow)}
.action{background:var(--fg);color:var(--surface);box-shadow:none}
.action .lab{color:var(--surface);opacity:.7}
.action h2{font-size:clamp(1.15rem,1.05rem + .5vw,1.4rem);line-height:1.3;margin:6px 0 14px}
.check{display:grid;gap:10px;counter-reset:s}
.check li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:center;padding:12px 14px;border-radius:4px;background:color-mix(in srgb,var(--surface) 14%,transparent);font-weight:550}
.check li::before{content:counter(s);display:grid;place-items:center;width:34px;height:34px;border-radius:4px;background:var(--surface);color:var(--fg);font:750 1rem var(--mono)}
.jump{display:inline-block;margin-top:14px;color:inherit;font:600 .8125rem/1.3 var(--mono);letter-spacing:.04em}
.blocked .bb{display:flex;gap:10px;margin:8px 0 14px;font-weight:550}
.blocked .bb .ic{color:var(--warn);margin-top:3px}
.ok-line{display:flex;gap:10px;padding-top:12px;margin-top:12px;border-top:1px solid var(--line);color:var(--mut);font-size:.9375rem}
.ok-line .ic{margin-top:3px}.ok-line b{color:var(--fg);font-weight:600}
.fig{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:12px;overflow-x:auto;box-shadow:var(--shadow)}
.fig svg{display:block;max-width:100%;height:auto;color:var(--mut)}
.node rect{fill:var(--surface);stroke:var(--c,var(--fg));stroke-width:1.5}
.node .t{font:600 15px var(--sans);fill:var(--fg)}.node .s{font:13px var(--mono);fill:var(--mut)}.node .st{color:var(--c)}
.node.service rect{stroke-width:3}.node.store rect{stroke-dasharray:2 3;stroke-width:2.25}.node.actor rect{rx:30}.node.external rect{stroke-dasharray:8 4}
.edge path{fill:none;stroke:currentColor;stroke-width:1.6}.edge text{font:13px var(--mono);fill:var(--fg);paint-order:stroke;stroke:var(--surface);stroke-width:5px}
.edge.branch path,.edge.return path{stroke-dasharray:7 5}.edge.fanout path{stroke-width:2.6}.edge.error{color:var(--bad)}.edge.error path{stroke:var(--bad);stroke-dasharray:2 4}marker .bad{fill:var(--bad)}
.flow .edge path{stroke-dasharray:6 6;animation:dash 1s linear infinite}
@keyframes dash{to{stroke-dashoffset:-12}}
.focus .node:not(.on),.focus .edge:not(.on){opacity:.22}
.node:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.dbox rect{fill:var(--surface);stroke:var(--c,var(--fg));stroke-width:1.5}.dbox .t{font:600 14px var(--sans);fill:var(--fg)}.dbox .s{font:12.5px var(--mono);fill:var(--mut)}.dbox .st{color:var(--c)}
.dline{stroke:var(--mut);stroke-width:1.6;fill:none}.dl{font:12.5px var(--mono);fill:var(--fg);paint-order:stroke;stroke:var(--surface);stroke-width:4px}
.dband{fill:var(--surface2)}.dlab{font:600 13px var(--mono);fill:var(--mut);text-transform:uppercase}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 0}
#detail,#stepnote{min-height:1.5em;margin:10px 0 0;color:var(--mut)}
#stepnote{color:var(--fg);font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:12px;color:var(--mut);font:.8125rem/1.4 var(--mono)}
.steps-note{margin:14px 0 0;padding-left:24px;max-width:70ch;list-style:decimal}
.path{display:none;margin:0;padding:0}
.path li{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-top:1px solid var(--line);padding:10px 0}.path li:first-child{border-top:0}
.path b{font-weight:600}
.verb{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 8px;font:.8125rem/1.6 var(--mono);color:var(--mut)}.verb.error{color:var(--bad);border-color:var(--bad)}.verb.branch,.verb.return{border-style:dashed}
.path-detail{display:none;margin-top:12px}.path-detail li{border-top:1px solid var(--line);padding:10px 0}.path-detail b{display:block}
.opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;align-items:start}
.opts.n2{grid-template-columns:repeat(2,minmax(0,1fr))}.opts.n4,.opts.n6{grid-template-columns:repeat(4,minmax(0,1fr))}.opts.n5{grid-template-columns:repeat(3,minmax(0,1fr))}
.opt{padding:22px 20px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow);display:grid;gap:12px;align-content:start;position:relative}
.opt.rec{background:var(--acc-bg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--acc) 45%,var(--surface))}
.opt .tag{position:absolute;top:-12px;left:16px;background:var(--acc);color:var(--surface);padding:3px 10px;border-radius:4px;font:700 .8125rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
.opt h3{font-size:1.15rem;line-height:1.3}.opt .ln{color:var(--mut)}
.opt .tot{font:750 1.9rem/1 var(--sans);font-variant-numeric:tabular-nums}.opt .tot small{font:500 .875rem var(--sans);color:var(--mut)}
.crit{display:grid;gap:7px}.crit div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;font-size:.9rem}
.dots{display:inline-flex;gap:3px}.dots i{width:14px;height:8px;border-radius:2px;background:var(--surface2);border:1px solid var(--line)}.dots i.on{background:var(--mut);border-color:var(--mut)}
.opt.rec .dots i.on{background:var(--acc);border-color:var(--acc)}
.pc{display:grid;gap:6px}.pc li{display:flex;gap:8px;font-size:.9375rem}.pc .ic{margin-top:3px}.pc .p .ic{color:var(--ok)}.pc .c .ic{color:var(--bad)}
.note{margin-top:14px;display:flex;gap:8px;color:var(--mut);font-size:.9rem}.note .ic{margin-top:3px}
.chart.card{padding:18px 20px;max-width:520px}
svg .ct{font:13px var(--sans);fill:var(--fg)}svg .ct.strong{font-weight:700}svg .cv{font:600 13px var(--mono);fill:var(--fg)}
svg .ctrack{fill:var(--surface2)}svg .cgrid{stroke:var(--line);stroke-width:1}svg .cring{stroke:var(--surface);stroke-width:2}
svg .cbig{font:750 22px var(--sans);fill:var(--fg)}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
figure.chart{background:var(--surface);border-radius:4px;box-shadow:var(--shadow);padding:18px 20px;display:grid;gap:12px;align-content:start}
figure.chart{align-self:start}
figure.chart svg{display:block;width:100%;max-width:380px;height:auto}
figure.chart.donut .cbody{display:flex;flex-wrap:wrap;gap:16px;align-items:center}figure.chart.donut svg{max-width:150px;flex:none}
.clegend{display:grid;gap:6px;min-width:0;flex:1 1 150px}.clegend li{display:grid;grid-template-columns:14px minmax(0,1fr) auto auto;gap:8px;align-items:center;font-size:.9rem}.clegend.row{display:flex;flex-wrap:wrap;gap:6px 16px}.clegend.row li{display:flex}
.clegend em{color:var(--mut);font-style:normal;font:.8125rem var(--mono)}.clegend b{font:600 .875rem var(--mono)}
.sw{width:12px;height:12px;border-radius:3px;background:var(--mut);display:inline-block}
.sw[data-s="1"]{background:var(--s1)}.sw[data-s="2"]{background:var(--s2)}.sw[data-s="3"]{background:var(--s3)}.sw[data-s="4"]{background:var(--s4)}.sw[data-s="5"]{background:var(--s5)}
.sw[data-t=ok]{background:var(--ok)}.sw[data-t=warn]{background:var(--warn)}.sw[data-t=bad]{background:var(--bad)}.sw[data-t=info]{background:var(--info)}.sw[data-t=mut]{background:var(--mut)}
.tv summary{cursor:pointer;font:600 .8125rem var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}.tv .tw{margin-top:8px}
.callouts{display:grid;gap:10px;margin-top:14px}.callout{display:flex;gap:12px;padding:14px 18px;border-radius:4px;background:var(--cb)}.callout .ic{color:var(--c);margin-top:2px}
.steps{display:grid;gap:0;position:relative}
.estep{display:grid;grid-template-columns:44px minmax(0,1fr) minmax(0,1.1fr);gap:4px 22px;padding:0 0 30px;position:relative}
.estep::before{content:"";position:absolute;left:16px;top:36px;bottom:0;width:2px;background:var(--line)}.estep:last-child::before{display:none}
.estep .no{display:grid;place-items:center;width:34px;height:34px;border-radius:4px;background:var(--fg);color:var(--surface);font:750 1rem var(--mono)}
.estep h3{font-size:1.2rem;line-height:1.3}.estep .sb p{color:var(--mut);margin-top:6px;max-width:48ch}
.estep .dg .fig{box-shadow:none}
.idea{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.7fr) minmax(0,1fr);gap:20px;align-items:center}
.idea .side{display:grid;gap:14px}.centre{display:grid;gap:8px;justify-items:center;text-align:center;padding:26px 18px;border-radius:4px;border:1px solid color-mix(in srgb,var(--acc) 45%,var(--surface));background:var(--acc-bg);color:var(--acc)}.centre b{color:var(--fg);font-size:1.25rem;line-height:1.25}
.branch{padding:16px 18px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow);display:grid;gap:10px;position:relative}
.branch h3{display:flex;gap:8px;align-items:center;font-size:1rem}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips li{padding:3px 10px;border-radius:4px;background:var(--surface2);font-size:.9rem}
.tl{position:relative;display:grid;gap:22px;padding-left:36px}
.tl::before{content:"";position:absolute;left:11px;top:6px;bottom:6px;width:2px;background:var(--line)}
.tl li{position:relative;display:grid;gap:2px}
.tl .dot{position:absolute;left:-36px;top:0;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--bg);color:var(--c);border:2px solid var(--c)}
.tl .dot .ic{width:14px;height:14px}.tl li.c-mut .dot{border-style:dashed}
.tl time{font:600 .8125rem var(--mono);letter-spacing:.06em;color:var(--mut)}.tl h3{font-size:1.05rem}.tl p{color:var(--mut);max-width:60ch}
.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.diff section{border:1px solid var(--line);border-radius:4px;background:var(--surface);overflow:hidden}
.diff h3{padding:10px 14px;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--line)}
.diff li{display:flex;gap:10px;padding:9px 14px;border-top:1px solid var(--line)}.diff li:first-child{border-top:0}
.diff li.add{background:var(--ok-bg)}.diff li.del{background:var(--bad-bg)}
.diff li .ic{margin-top:3px}.diff li.add .ic{color:var(--ok)}.diff li.del .ic{color:var(--bad)}.diff li.same .ic{opacity:0}
.dr{display:grid;gap:12px}.dr .ctx{max-width:70ch;font-size:1.05rem}
.pull{margin:14px 0;padding:26px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.pull .ic{color:var(--acc);width:36px;height:36px}.pull .lab{color:var(--acc);margin:8px 0}
.pull .big{font:italic 500 clamp(1.4rem,1.15rem + 1.2vw,2rem)/1.3 var(--serif);max-width:34em}
.cons{display:grid;gap:8px}.cons li{display:flex;gap:10px}.cons .ic{color:var(--ok);margin-top:3px}
.dec{display:grid;gap:12px}
.dec li{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:6px 28px;align-items:start;padding:18px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow)}
.dec .q{grid-column:1;font-size:1.1rem;line-height:1.4;font-weight:600}
.dec .rec{grid-column:2;grid-row:1 / span 2;padding:10px 14px;background:var(--acc-bg);border-radius:4px}.dec .rec .lab{color:var(--acc)}.dec .rec p{margin-top:4px;font-weight:500}
.dec .chg{grid-column:1;color:var(--mut);font-size:.9375rem}.dec .chg .lab{margin-right:8px}
.evs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.ev{padding:16px 18px;border-radius:4px;background:var(--surface);box-shadow:var(--shadow);display:grid;gap:10px;align-content:start}
.ev b{font-weight:600;line-height:1.35}.ev .pr{color:var(--mut);font-size:.875rem}.ev .rs{font:600 .9375rem var(--mono)}
.badge{display:inline-flex;align-items:center;gap:6px;justify-self:start;border-radius:4px;padding:3px 9px;background:var(--cb);color:var(--c);font:600 .8125rem/1.3 var(--mono);letter-spacing:.03em}
.ev-verified{--c:var(--ok);--cb:var(--ok-bg)}.ev-inferred{--c:var(--warn);--cb:var(--warn-bg)}.ev-guess{--c:var(--mut);--cb:var(--surface2)}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th{font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);text-align:left;padding:0 14px 8px 0;border-bottom:1px solid var(--fg)}
td{text-align:left;vertical-align:top;border-top:1px solid var(--line);padding:11px 14px 11px 0}
tbody tr:first-child td{border-top:0}
.log{background:var(--surface);border-radius:4px;box-shadow:var(--shadow)}
.log li{display:grid;grid-template-columns:110px 1fr;gap:14px;padding:12px 18px;border-top:1px solid var(--line)}.log li:first-child{border-top:0}.log time{font:600 .8125rem var(--mono);color:var(--mut);padding-top:2px}
.links{display:grid;gap:6px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font:.8125rem/1.5 var(--mono);color:var(--mut)}
.deck{display:none}
html.present{font-size:1.15em}
html.present [data-slide]{display:none}
html.present [data-slide].cur{display:block;min-height:calc(100vh - 140px)}
html.present .banner.cur{display:grid;align-content:center}
html.present .mini,html.present footer,html.present .two:not(.cur){display:none}
html.present .deck{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;gap:12px;align-items:center;justify-content:center;padding:10px;background:var(--bg);border-top:1px solid var(--line)}
html.present .deck span{font:600 .875rem var(--mono);color:var(--mut)}
@media (max-width:860px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.two,.charts,.evs,.opts,.opts.n2,.opts.n4,.opts.n5,.opts.n6{grid-template-columns:1fr}.banner{grid-template-columns:1fr;padding:22px;gap:14px}.b-ic{width:60px;height:60px}.b-ic .ic{width:38px;height:38px}
.strip{grid-auto-flow:row;gap:0}.seg{grid-template-columns:8px minmax(0,1fr);column-gap:14px;padding:10px 0;border-top:1px solid var(--line)}.seg:first-child{border-top:0}.seg .bar{grid-row:1 / span 2;height:100%;min-height:36px;width:6px;justify-self:center}
.log li{grid-template-columns:1fr;gap:2px}.dec li{display:block}.dec .rec{margin-top:12px}.diff{grid-template-columns:1fr}.estep{grid-template-columns:44px minmax(0,1fr)}.estep .dg{grid-column:2}
.idea{grid-template-columns:1fr}.idea .centre{order:-1}
.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.stack,.stack tbody,.stack tr,.stack td{display:block;width:100%}.stack tr{padding:12px 0;border-top:1px solid var(--line)}.stack tbody tr:first-child{border-top:0;padding-top:0}.stack td{border:0;padding:3px 0}
.stack td[data-label]::before{content:attr(data-label);display:block;font:600 .8125rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin-bottom:2px}
.wrap{padding:12px 16px 56px}.sec{margin-top:32px}}
@media (prefers-reduced-motion:reduce){.flow .edge path{animation:none}.mini{transition:none}}
@media print{body{background:#fff;color:#000}.mini,.tools,.deck,.bar{display:none}.fig{overflow:visible;display:block!important}.path,.path-detail{display:none!important}[data-slide]{display:block!important;break-inside:avoid}.banner{break-after:page}.flow .edge path{animation:none}.focus .node:not(.on),.focus .edge:not(.on){opacity:1}}`;

/** The page's script: theme, the mini header, detail on hover or focus, play and numbered steps, and the presentation mode. Text is set with textContent only. */
export const PAGE_JS = `(()=>{
const d=document,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>[...r.querySelectorAll(s)],root=d.documentElement;
try{const t=localStorage.getItem('vz-theme');if(t==='dark'||t==='light')root.dataset.theme=t}catch(e){}
const tb=q('#theme');
if(tb)tb.onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches,n=dark?'light':'dark';root.dataset.theme=n;try{localStorage.setItem('vz-theme',n)}catch(e){}};
const hero=q('[data-hero]'),mini=q('.mini');
if(hero&&mini&&'IntersectionObserver'in window)new IntersectionObserver(([e])=>mini.classList.toggle('on',!e.isIntersecting),{threshold:0}).observe(hero);
const slides=qa('[data-slide]'),pb=q('#present'),count=q('#slide-count');
let cur=0;
const show=i=>{cur=Math.max(0,Math.min(slides.length-1,i));slides.forEach((s,k)=>s.classList.toggle('cur',k===cur));if(count)count.textContent=(cur+1)+' / '+slides.length;scrollTo(0,0)};
const present=on=>{root.classList.toggle('present',on);if(pb)pb.textContent=on?pb.dataset.off:pb.dataset.on;if(on)show(cur);else slides.forEach(s=>s.classList.remove('cur'))};
if(pb)pb.onclick=()=>present(!root.classList.contains('present'));
const sp=q('#slide-prev'),sn=q('#slide-next');
if(sp)sp.onclick=()=>show(cur-1);
if(sn)sn.onclick=()=>show(cur+1);
addEventListener('keydown',e=>{if(!root.classList.contains('present'))return;const k=e.key;
if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '){e.preventDefault();show(cur+1)}
else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'){e.preventDefault();show(cur-1)}
else if(k==='Home'){show(0)}else if(k==='End'){show(slides.length-1)}else if(k==='Escape'){present(false)}});
if(new URLSearchParams(location.search).get('present')==='1')present(true);
const fig=q('.fig'),panel=q('#detail');
qa('[data-node]').forEach(n=>{const show=()=>{if(panel)panel.textContent=n.dataset.detail};n.addEventListener('mouseenter',show);n.addEventListener('focus',show)});
const pp=q('#play');
if(pp&&fig)pp.onclick=()=>{const on=fig.classList.toggle('flow');pp.textContent=on?pp.dataset.pause:pp.dataset.play;pp.setAttribute('aria-pressed',String(on))};
const raw=q('#steps');
if(raw&&fig){
const steps=JSON.parse(raw.textContent),note=q('#stepnote'),prev=q('#prev'),next=q('#next'),all=q('#all');
let at=-1;
const go=i=>{at=i;qa('.on',fig).forEach(x=>x.classList.remove('on'));
if(i<0){fig.classList.remove('focus');note.textContent='';return}
const s=steps[i];fig.classList.add('focus');
s.nodes.forEach(id=>q('[data-node="'+id+'"]',fig)?.classList.add('on'));
s.edges.forEach(id=>q('[data-edge="'+id+'"]',fig)?.classList.add('on'));
note.textContent=(i+1)+'/'+steps.length+'  '+s.title+' - '+s.note};
if(prev)prev.onclick=()=>go(Math.max(0,at-1));
if(next)next.onclick=()=>go(Math.min(steps.length-1,at+1));
if(all)all.onclick=()=>go(-1);
}
})();`;
