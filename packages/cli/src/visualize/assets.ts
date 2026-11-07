/** The colours a state or a chart series needs that are not the project's: the same names in both themes. */
export interface IStatePalette {
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  bad: string;
  badBg: string;
  info: string;
  infoBg: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
}

/**
 * Fixed state colours and the five chart series. `warn` is the amber of an inferred claim; a task that waits for the
 * owner is the project's hot accent instead, so what needs the owner is one colour on the page.
 */
const STATE_PALETTE: { light: IStatePalette; dark: IStatePalette } = {
  light: {
    ok: '#157a3a',
    okBg: '#e4f3e8',
    warn: '#9c5a06',
    warnBg: '#fcefd8',
    bad: '#bd2820',
    badBg: '#fbe8e6',
    info: '#1c5ccc',
    infoBg: '#e6edfb',
    s1: '#2a78d6',
    s2: '#eb6834',
    s3: '#1baf7a',
    s4: '#eda100',
    s5: '#e87ba4',
  },
  dark: {
    ok: '#5fd18a',
    okBg: '#13261b',
    warn: '#f0b955',
    warnBg: '#2b2212',
    bad: '#ff8a80',
    badBg: '#2d1816',
    info: '#7ab0ff',
    infoBg: '#14213a',
    s1: '#3987e5',
    s2: '#d95926',
    s3: '#199e70',
    s4: '#c98500',
    s5: '#d55181',
  },
};

const declarations = (opts: { palette: IStatePalette }): string => {
  const p = opts.palette;

  return `--ok:${p.ok};--ok-bg:${p.okBg};--warn:${p.warn};--warn-bg:${p.warnBg};--bad:${p.bad};--bad-bg:${p.badBg};--info:${p.info};--info-bg:${p.infoBg};--s1:${p.s1};--s2:${p.s2};--s3:${p.s3};--s4:${p.s4};--s5:${p.s5}`;
};

/** The state colours in the same three-block form as the project tokens: light, system dark, explicit dark. */
const STATE_CSS = `:root{${declarations({ palette: STATE_PALETTE.light })}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${declarations({ palette: STATE_PALETTE.dark })}}}
:root[data-theme=dark]{${declarations({ palette: STATE_PALETTE.dark })}}`;

/** The dark values, set again on everything that sits on the always-dark slab. */
const SLAB_STATES = declarations({ palette: STATE_PALETTE.dark });

const BASE_CSS = [
  // Reset and the page.
  `:root{--font:'Inter','Inter Display',system-ui,-apple-system,'Segoe UI',sans-serif;--code:ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace;--radius:4px;--raise:var(--bg);--line:color-mix(in srgb,var(--ink) 12%,transparent)}`,
  `*{box-sizing:border-box}`,
  `html{-webkit-text-size-adjust:100%;scroll-padding-top:84px}`,
  `@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}`,
  `body{margin:0;background:var(--bg);color:var(--body);font:17px/1.55 var(--font);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}`,
  `h1,h2,h3,p,ol,ul,figure,blockquote{margin:0}`,
  `h1,h2,h3{color:var(--ink);text-wrap:balance;font-weight:650;letter-spacing:-.03em}`,
  `ol,ul{padding:0;list-style:none}`,
  `a{color:inherit;text-underline-offset:3px}`,
  `code{font-family:var(--code);font-size:.88em}`,
  `.wrap{max-width:1240px;margin:0 auto;padding-inline:16px}`,
  `.ic{flex:none;display:inline-block;vertical-align:middle}`,
  `.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`,
  `.mut{color:var(--muted)}`,
  `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`,
  // The slab, the figure window, the pull-quote, the top bar and the slide deck are dark in both themes: the page tokens are redefined for them.
  `.slab,.win,.pull,.deck{--bg:var(--slab);--bg-soft:var(--slab-2);--raise:var(--slab-3);--ink:var(--slab-ink);--body:var(--slab-body);--muted:var(--slab-muted);--accent:var(--hot);--accent-soft:var(--slab-3);--accent-ink:var(--hot-ink);--line:#ffffff1f;${SLAB_STATES};color:var(--body);background-color:var(--slab)}`,
  `.slab,.win,.pull{background-image:radial-gradient(var(--slab-dot) 1px,transparent 1.2px);background-size:16px 16px}`,
  // The tone of a thing: a colour for marks and words, a tint for its field.
  `.c-ok{--c:var(--ok);--cb:var(--ok-bg)}.c-warn{--c:var(--accent);--cb:var(--accent-soft)}.c-bad{--c:var(--bad);--cb:var(--bad-bg)}.c-info{--c:var(--info);--cb:var(--info-bg)}.c-mut{--c:var(--muted);--cb:var(--bg-soft)}`,
  `.chip{display:inline-flex;align-items:center;gap:8px;color:var(--c);font:600 13.5px/1.2 var(--font);letter-spacing:.02em;white-space:nowrap}`,
  `.lab{font:600 13.5px/1.3 var(--font);color:var(--muted)}`,
  `.inl{display:inline-flex;margin-right:6px;color:var(--c)}`,
  `.btn{font:600 13.5px/1.2 var(--font);color:var(--body);background:transparent;border:1px solid var(--line);border-radius:var(--radius);padding:8px 12px;cursor:pointer;transition:color .2s,background-color .2s,border-color .2s}`,
  `.btn:hover{color:var(--ink);border-color:var(--muted)}`,
  `.btn:focus-visible{outline:2px solid var(--accent)}`,
  `.btn[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}`,
  `html:not(.js) .js-only,html:not(.js) .theme{display:none}`,
  `html:not(.js) .steps button{cursor:default;pointer-events:none}`,
  // The top bar: part of the slab, sticky, 64 px, with the theme switch.
  `body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--slab)}`,
  `.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:9;box-shadow:inset 0 -1px 0 #ffffff14}`,
  `.top .wrap{height:64px;display:flex;align-items:center;gap:14px}`,
  `.mark{width:13px;height:17px;fill:var(--hot);flex:none}`,
  `.top .ttl{color:var(--ink);font-weight:650;font-size:16px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:36ch}`,
  `.top nav{margin-left:auto;display:flex;align-items:center;gap:6px;min-width:0}`,
  `.top .links{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;min-width:0;mask-image:linear-gradient(90deg,#000 calc(100% - 32px),transparent)}`,
  `.top .links::-webkit-scrollbar{display:none}`,
  `.top .links a{color:var(--body);text-decoration:none;font-size:14.5px;font-weight:500;padding:8px 10px;border-radius:var(--radius);white-space:nowrap;transition:color .2s,background-color .2s}`,
  `.top .links a:hover{color:var(--ink);background:#ffffff0d}`,
  `.top .sep{width:1px;height:20px;background:#ffffff1f;margin:0 8px;flex:none}`,
  `.top .stamp{color:var(--muted);font-size:13.5px;white-space:nowrap}`,
  `.theme{all:unset;box-sizing:border-box;cursor:pointer;position:relative;width:36px;height:36px;border-radius:var(--radius);color:var(--body);flex:none;transition:color .25s,background-color .25s}`,
  `.theme:hover{color:var(--ink);background:#ffffff0d}`,
  `.theme:focus-visible{outline:2px solid var(--hot);outline-offset:1px}`,
  `.theme svg{position:absolute;top:8px;left:8px;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .4s cubic-bezier(.22,1,.36,1),opacity .25s ease}`,
  `.theme .moon{opacity:0;transform:rotate(-90deg) scale(.6)}`,
  `:root[data-theme=dark] .theme .sun{opacity:0;transform:rotate(90deg) scale(.6)}:root[data-theme=dark] .theme .moon{opacity:1;transform:none}`,
  `@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .theme .sun{opacity:0;transform:rotate(90deg) scale(.6)}:root:not([data-theme=light]) .theme .moon{opacity:1;transform:none}}`,
  `.theme .tip{position:absolute;top:calc(100% + 8px);right:0;white-space:nowrap;background:var(--slab-2);color:var(--slab-ink);font-size:13px;padding:6px 10px;border-radius:var(--radius);opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .15s,transform .15s;box-shadow:0 8px 24px #0006}`,
  `.theme:hover .tip,.theme:focus-visible .tip{opacity:1;transform:none}`,
  `::view-transition-old(root),::view-transition-new(root){animation-duration:200ms;animation-timing-function:ease}`,
  `.theme-fade,.theme-fade *{transition:background-color .2s ease,color .2s ease,fill .2s ease,stroke .2s ease!important}`,
  // The hero slab: the state, the title, the verdict, and the flow when the spec has one.
  `.hero{padding-block:56px}`,
  `.hero .state{display:inline-flex;align-items:center;gap:10px;margin-bottom:28px;color:var(--c);font:650 14.5px/1 var(--font);text-transform:uppercase;letter-spacing:.07em}`,
  `.hero h1{font-size:clamp(32px,5vw,72px);line-height:1.02;max-width:30ch;letter-spacing:-.045em;color:var(--ink);overflow-wrap:anywhere}`,
  `.hero .lede{margin-top:28px;font-size:clamp(18px,1.6vw,22px);max-width:46ch;color:var(--body)}`,
  `.hero .cap{margin-top:14px;max-width:60ch;color:var(--muted)}`,
  `.hero .meta{margin-top:22px;display:flex;flex-wrap:wrap;gap:4px 20px;font:500 13px/1.4 var(--font);color:var(--muted)}`,
  // Sections: each a part with its title; the compositions below differ from neighbour to neighbour.
  `.part{padding-top:88px}`,
  `.sh{font-size:clamp(26px,3vw,40px);line-height:1.05;margin-bottom:36px;max-width:30ch}`,
  `.panels{display:grid;gap:2px;border-radius:var(--radius);overflow:hidden}`,
  // Tiles: fields of colour with a big number.
  `.slide-tiles{padding-top:56px}`,
  `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.tile{position:relative;display:grid;align-content:start;padding:28px 26px 30px;background:var(--bg-soft)}`,
  `.tile.c-ok,.tile.c-warn,.tile.c-bad,.tile.c-info{background:var(--cb)}`,
  `.tile .n{font-size:clamp(36px,4.4vw,60px);line-height:.95;font-weight:650;letter-spacing:-.05em;color:var(--ink);overflow-wrap:anywhere;margin-bottom:10px}`,
  `.tile .l{color:var(--body);font-size:16px}`,
  `.tile .ic{position:absolute;top:22px;right:22px;color:var(--c)}`,
  // The minimap: a track, a stripe and a word per task.
  `.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.seg{display:grid;align-content:start;padding:0 20px 22px;background:var(--bg-soft)}`,
  `.seg.c-warn{background:var(--accent-soft)}`,
  `.seg .bar{display:block;height:6px;margin:0 -20px 12px;background:var(--c)}`,
  `.seg.c-mut .bar{background:repeating-linear-gradient(90deg,var(--muted) 0 6px,transparent 6px 12px);opacity:.7}`,
  `.seg .nm{display:grid;gap:6px;align-content:start;margin-bottom:10px}.seg .tn{font-weight:600;color:var(--ink);font-size:17px;line-height:1.3}`,
  `.seg .nt{color:var(--muted);font-size:15px;line-height:1.4}`,
  // What the owner has to do, what blocks it, and the two quiet facts.
  `.two{padding-top:72px}`,
  `.own{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,4fr);gap:2px;border-radius:var(--radius) var(--radius) 0 0;overflow:hidden}`,
  `.own .nx{background:var(--bg-soft);padding:34px 34px 36px}`,
  `.own .nx h2{font-size:clamp(24px,2.6vw,34px);line-height:1.15;letter-spacing:-.025em;margin:8px 0 0;max-width:30ch}`,
  `.own .stop{background:var(--accent-soft);padding:34px 30px;display:grid;gap:10px;align-content:start;color:var(--ink)}`,
  `.own .stop .lab{color:var(--accent)}.own .stop .lab+p{font-size:20px;line-height:1.35;letter-spacing:-.01em;font-weight:550}`,
  `.check{display:grid;gap:8px;counter-reset:s;margin-top:22px}`,
  `.check li{counter-increment:s;display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;align-items:center;padding:12px 14px;border-radius:var(--radius);background:var(--bg);color:var(--ink);font-weight:550}`,
  `.check li::before{content:counter(s);display:grid;place-items:center;width:30px;height:30px;border-radius:var(--radius);background:var(--ink);color:var(--bg);font:650 15px var(--font)}`,
  `.jump{display:inline-block;margin-top:20px;color:var(--ink);font-weight:600;font-size:15px}`,
  `.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;margin-top:2px;border-radius:0 0 var(--radius) var(--radius);overflow:hidden}`,
  `.fact{display:flex;gap:12px;padding:20px 26px;background:var(--bg-soft);color:var(--body);font-size:16px}`,
  `.fact .ic{margin-top:3px;color:var(--muted)}.fact b{color:var(--ink);font-weight:600}`,
  // The flow in the hero: the figure straight on the slab, then its steps and the line that says what is picked.
  `.figure{margin-top:52px}`,
  `.figure>.lab{margin-bottom:14px}`,
  `.fig{overflow-x:auto}`,
  `.fig svg{display:block;width:100%;height:auto;margin-inline:auto;color:var(--muted)}`,
  `.win{padding:16px;border-radius:var(--radius)}`,
  `.node rect{fill:var(--bg-soft)}`,
  `.node .t{font:600 15px var(--font);fill:var(--ink);letter-spacing:-.01em}`,
  `.node .s{font:13px var(--font);fill:var(--muted)}`,
  `.node .st{color:var(--c)}`,
  `.node.service rect{stroke:var(--ink);stroke-width:2}.node.store rect{stroke:var(--muted);stroke-width:2;stroke-dasharray:2 4}.node.actor rect{rx:30}.node.external rect{stroke:var(--muted);stroke-width:2;stroke-dasharray:8 5}`,
  `.node.gate rect{fill:var(--raise);stroke:var(--hot);stroke-width:2}`,
  `.gate .halo{fill:var(--hot-glow)}.gate .core{fill:var(--hot)}.gate .st{color:var(--hot-ink)}`,
  `.edge path{fill:none;stroke:var(--muted);stroke-width:2}`,
  `.edge text{font:13px var(--font);fill:var(--body);paint-order:stroke;stroke:var(--bg);stroke-width:5px;stroke-linejoin:round}`,
  `.edge.branch path,.edge.return path{stroke-dasharray:7 6}.edge.fanout path{stroke:var(--ink);stroke-width:3.5}.edge.fanout text{font-weight:650}`,
  `.edge.error path{stroke:var(--bad);stroke-dasharray:2 5;stroke-linecap:round}.edge.error text{fill:var(--bad)}`,
  `.edge.hot path{stroke:var(--hot);stroke-width:3}.edge.hot text{fill:var(--hot)}`,
  `marker .ah{fill:var(--muted)}marker .bad{fill:var(--bad)}marker .hot{fill:var(--hot)}`,
  `.fig.playing .edge path{stroke-dasharray:6 6;animation:dash 1s linear infinite}`,
  `@keyframes dash{to{stroke-dashoffset:-12}}`,
  `.node,.edge{transition:opacity .25s ease}`,
  `.focus .node:not(.on),.focus .edge:not(.on){opacity:.22}`,
  `.node:focus-visible{outline:2px solid var(--hot);outline-offset:2px}`,
  `.legend{display:flex;flex-wrap:wrap;gap:8px 28px;margin-top:22px;color:var(--body);font-size:14.5px}`,
  `.legend li{display:flex;align-items:center;gap:10px}.legend .lg{width:44px;height:12px;flex:none;overflow:visible}.legend .edge path{stroke-width:2}`,
  // Phone list of a figure.
  `.path{display:none;margin:0}`,
  `.path li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:14px 16px;background:var(--bg-soft);margin-top:2px;color:var(--body);font-size:15px}.path li:first-child{margin-top:0;border-radius:var(--radius) var(--radius) 0 0}.path li:last-child{border-radius:0 0 var(--radius) var(--radius)}`,
  `.path b{font-weight:600;color:var(--ink)}`,
  `.verb{display:inline-block;border:1px solid var(--line);border-radius:var(--radius);padding:0 8px;font:13px/1.7 var(--font);color:var(--muted)}.verb.error{color:var(--bad);border-color:var(--bad)}.verb.branch,.verb.return{border-style:dashed}`,
  `.path-detail{display:none;margin-top:12px;color:var(--body)}.path-detail li{padding:10px 0;border-top:1px solid var(--line)}.path-detail b{display:block;color:var(--ink)}`,
  // The steps: panels to press; the line below says what is picked.
  `.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:2px;margin-top:36px;border-radius:var(--radius);overflow:hidden}`,
  `.steps li{display:grid;align-content:start;background:var(--bg-soft)}`,
  `.steps button{all:unset;box-sizing:border-box;cursor:pointer;display:grid;align-content:start;gap:6px;width:100%;padding:16px;color:var(--body);transition:background-color .2s,color .2s}`,
  `.steps button b{color:var(--ink);font-weight:600;font-size:16px;line-height:1.3;letter-spacing:0}.steps button span{font-size:14px;color:var(--muted)}`,
  `.steps button:hover{background:var(--raise)}`,
  `.steps button:focus-visible{outline:2px solid var(--hot);outline-offset:-2px}`,
  `.steps button[aria-pressed=true]{background:var(--hot)}.steps button[aria-pressed=true] b,.steps button[aria-pressed=true] span{color:var(--hot-ink)}`,
  `.steps .explain{padding:0 16px 16px;font-size:15px;color:var(--body)}`,
  `.js .steps .explain{display:none}`,
  `html:not(.js) .steps{grid-template-columns:minmax(0,1fr)}`,
  `.say{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:start;margin-top:26px;min-height:5em}`,
  `html:not(.js) .say{display:none}`,
  `.say p{color:var(--ink);font-size:clamp(18px,1.7vw,24px);line-height:1.4;max-width:46ch;letter-spacing:-.01em}`,
  `.say .ctl{display:flex;gap:8px;flex-wrap:wrap}.say .ctl[hidden],.say [hidden]{display:none}`,
  // Architecture and explainer drawings sit in a dark window.
  `.dband{fill:var(--bg-soft)}`,
  `.dbox rect{fill:var(--raise)}.dbox.c-ok rect,.dbox.c-warn rect,.dbox.c-bad rect,.dbox.c-info rect,.dbox.c-mut rect{stroke:var(--c);stroke-width:1.5}`,
  `.dbox .t{font:600 14px var(--font);fill:var(--ink)}.dbox .s{font:12.5px var(--font);fill:var(--muted)}.dbox .st{color:var(--c)}`,
  `.dline{stroke:var(--muted);stroke-width:2;fill:none}`,
  `.dl{font:12.5px var(--font);fill:var(--body);paint-order:stroke;stroke:var(--bg);stroke-width:4px}`,
  `.dlab{font:600 13px var(--font);fill:var(--muted)}`,
  `.win .path{margin-top:0}`,
  // Comparison: panels side by side, the big total, the recommended pick filled.
  `.ranks{max-width:520px;margin-bottom:28px}`,
  `.ranks svg{display:block;width:100%;height:auto;margin-top:8px}`,
  `.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.opt{display:grid;align-content:start;padding:32px 30px 34px;background:var(--bg-soft)}`,
  `.opt.rec{background:var(--accent-soft)}`,
  `.opt .tag-slot{display:block}.opt .tag{display:inline-block;margin-bottom:18px;background:var(--accent);color:var(--accent-ink);padding:4px 10px;border-radius:var(--radius);font:650 13px/1.3 var(--font)}`,
  `.opt h3{font-size:24px;line-height:1.2;margin-bottom:18px}.opt .ln{color:var(--body);max-width:46ch;margin-bottom:18px}`,
  `.opt .tot{display:flex;align-items:baseline;gap:12px;font-size:clamp(64px,7vw,104px);line-height:.85;font-weight:650;letter-spacing:-.05em;color:var(--ink);margin-bottom:18px}`,
  `.opt .tot small{font:600 18px/1.2 var(--font);letter-spacing:0;color:var(--ink)}`,
  `.opt.rec .tot{color:var(--accent)}`,
  `.crit{display:grid;margin-bottom:18px}.crit div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;font-size:15.5px}.crit div+div{margin-top:8px}`,
  `.dots{display:inline-flex;gap:3px}.dots i{width:16px;height:8px;border-radius:2px;background:var(--line)}.dots i.on{background:var(--ink)}.opt.rec .dots i.on{background:var(--accent)}`,
  `.pc{display:grid}.pc li{display:flex;gap:8px;font-size:15.5px}.pc li+li{margin-top:6px}.pc.proslist{margin-bottom:6px}.pc .ic{margin-top:4px}.pc .p .ic{color:var(--ok)}.pc .c .ic{color:var(--bad)}`,
  // The cards of a row take their rows from the grid: the score, the title, each criterion and each pro of one card sit at the height of the same part of its neighbours (see grid-span.ts).
  `@supports (grid-template-rows:subgrid){.steps li{grid-template-rows:subgrid;grid-row-end:span 3}.steps button{grid-template-rows:subgrid;grid-row-end:span 2}.tiles .tile{grid-template-rows:subgrid;grid-row-end:span 2}.strip .seg{grid-template-rows:subgrid;grid-row-end:span 3}.charts figure.chart{grid-template-rows:subgrid;grid-row-end:span 3}.diff .ba{grid-template-rows:subgrid;grid-row-end:span 2}}`,
  `@media (min-width:621px){@supports (grid-template-rows:subgrid){.opt,.crit,.pc{grid-template-rows:subgrid}.idea .branch{grid-template-rows:subgrid;grid-row-end:span 3}}}`,
  // One column (a phone): nothing is shared across cards, so a row kept for a part this card lacks is only a gap.
  `@media (max-width:620px){.opt .ln:empty,.pc:empty{display:none}}`,
  `.note{margin-top:20px;display:flex;gap:8px;max-width:70ch;color:var(--muted);font-size:15.5px}.note .ic{margin-top:4px}`,
  // Idea map: a dark centre between two columns of panels.
  `.idea{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.7fr) minmax(0,1fr);gap:2px}`,
  `.idea .bs{display:contents}.idea .branch:nth-child(odd){grid-column:1}.idea .branch:nth-child(even){grid-column:3}`,
  `.centre{display:grid;gap:12px;justify-items:center;align-content:center;text-align:center;padding:40px 24px;border-radius:var(--radius)}`,
  `.idea .centre{grid-column:2;grid-row-start:1}`,
  `.centre .ic{color:var(--hot)}.centre b{color:var(--ink);font-size:clamp(20px,2vw,26px);line-height:1.2;letter-spacing:-.02em}`,
  `.branch{display:grid;align-content:start;padding:22px 24px;background:var(--bg-soft);box-shadow:inset 4px 0 0 var(--sc,var(--muted))}`,
  `.branch[data-s="1"]{--sc:var(--s1)}.branch[data-s="2"]{--sc:var(--s2)}.branch[data-s="3"]{--sc:var(--s3)}.branch[data-s="4"]{--sc:var(--s4)}.branch[data-s="5"]{--sc:var(--s5)}`,
  `.branch h3{display:flex;gap:10px;align-items:center;font-size:18px;letter-spacing:-.01em;margin-bottom:12px}`,
  `.chips{display:flex;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:6px;margin-bottom:12px}.chips li{padding:3px 10px;border-radius:var(--radius);background:var(--bg);color:var(--ink);font-size:15px}`,
  // Explainer: a big numeral, the words, then the drawing.
  `.ex{display:grid;gap:60px}`,
  `.estep{display:grid;grid-template-columns:96px minmax(0,1fr) minmax(0,1.3fr);gap:10px 32px;align-items:start}`,
  `.estep .no{font-size:72px;line-height:.8;font-weight:650;letter-spacing:-.05em;color:var(--ink)}`,
  `.estep h3{font-size:24px;line-height:1.2}.estep .sb p{margin-top:10px;max-width:44ch;color:var(--body)}`,
  // Timeline: a rule with a ring per date.
  `.tl{position:relative;display:grid;gap:28px;padding-left:46px;max-width:76ch}`,
  `.tl::before{content:"";position:absolute;left:13px;top:8px;bottom:8px;width:2px;background:var(--line)}`,
  `.tl li{position:relative;display:grid;gap:3px}`,
  `.tl .dot{position:absolute;left:-46px;top:0;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bg);color:var(--c);border:2px solid var(--c)}`,
  `.tl .dot .ic{width:15px;height:15px}.tl li.c-mut .dot{border-style:dashed}`,
  `.tl time{font:600 14px/1.4 var(--font);color:var(--muted)}.tl h3{font-size:20px;line-height:1.25}.tl p{color:var(--body);max-width:60ch}`,
  // Findings: tiles, panels with a chart each, and callouts with a stripe.
  `.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:2px;margin-top:2px;border-radius:var(--radius);overflow:hidden}`,
  `.tiles+.charts{margin-top:2px}`,
  `figure.chart{display:grid;align-content:start;padding:26px 28px;background:var(--bg-soft)}figure.chart>.lab,figure.chart .cbody{margin-bottom:16px}`,
  `figure.chart svg{display:block;width:100%;max-width:380px;height:auto}`,
  `figure.chart.donut .cbody{display:flex;flex-wrap:wrap;gap:16px;align-items:center}figure.chart.donut svg{max-width:150px;flex:none}`,
  `svg .ct{font:13px var(--font);fill:var(--body)}svg .ct.strong{font-weight:700;fill:var(--ink)}svg .cv{font:600 13px var(--font);fill:var(--ink)}`,
  `svg .ctrack{fill:var(--line)}svg .cgrid{stroke:var(--line);stroke-width:1}svg .cring{stroke:var(--bg-soft);stroke-width:2}`,
  `svg .cbig{font:650 22px var(--font);fill:var(--ink)}`,
  `.clegend{display:grid;gap:6px;min-width:0;flex:1 1 150px}.clegend li{display:grid;grid-template-columns:14px minmax(0,1fr) auto auto;gap:8px;align-items:center;font-size:15px}.clegend.row{display:flex;flex-wrap:wrap;gap:6px 16px}.clegend.row li{display:flex}`,
  `.clegend em{color:var(--muted);font-style:normal;font-size:13px}.clegend b{font-weight:600;font-size:14px;color:var(--ink)}`,
  `.sw{width:12px;height:12px;border-radius:3px;background:var(--muted);display:inline-block}`,
  `.sw[data-s="1"]{background:var(--s1)}.sw[data-s="2"]{background:var(--s2)}.sw[data-s="3"]{background:var(--s3)}.sw[data-s="4"]{background:var(--s4)}.sw[data-s="5"]{background:var(--s5)}`,
  `.sw[data-t=ok]{background:var(--ok)}.sw[data-t=warn]{background:var(--accent)}.sw[data-t=bad]{background:var(--bad)}.sw[data-t=info]{background:var(--info)}.sw[data-t=mut]{background:var(--muted)}`,
  `.tv summary{cursor:pointer;font:600 13.5px var(--font);color:var(--muted)}.tv .tw{margin-top:8px}`,
  `.callouts{display:grid;gap:2px;margin-top:2px;border-radius:var(--radius);overflow:hidden}`,
  `.callout{display:flex;gap:14px;padding:20px 24px;background:var(--cb);box-shadow:inset 4px 0 0 var(--c);color:var(--ink)}.callout .ic{color:var(--c);margin-top:2px}`,
  // Before and after: two panels; a plus or a minus, its word, and a line style.
  `.diff{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.ba{display:grid;align-content:start;background:var(--bg-soft);padding:28px 30px 30px}.ba h3{font-size:22px;margin-bottom:18px}`,
  `.ba li{display:flex;gap:12px;padding:11px 0 11px 14px;border-left:3px solid transparent;color:var(--body)}`,
  `.ba li .ic{margin-top:4px;flex:none}.ba li.same .ic{opacity:0}`,
  `.ba li.add{border-left:4px solid var(--ink);color:var(--ink);font-weight:550}`,
  `.ba li.del{border-left:3px dotted var(--muted)}.ba li.del .tx{text-decoration:line-through;text-decoration-thickness:1px}`,
  `.wd{display:inline-block;margin-right:8px;font:650 12.5px/1.4 var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--ink);text-decoration:none}`,
  // Decision record: the context, the options, the decision as a dark pull-quote, the consequences.
  `.dr{display:grid;gap:28px}.dr .ctx{max-width:64ch;font-size:19px;color:var(--ink)}`,
  `.pull{padding:clamp(28px,5vw,60px);border-radius:var(--radius)}`,
  `.pull .ic{color:var(--hot);width:36px;height:36px}.pull .lab{color:var(--accent);margin:12px 0 10px}`,
  `.pull .big{max-width:30ch;font-size:clamp(26px,3.4vw,46px);line-height:1.15;font-weight:650;letter-spacing:-.03em;color:var(--ink)}`,
  `.cons{display:grid;gap:10px}.cons li{display:flex;gap:12px;font-size:17px}.cons .ic{color:var(--ok);margin-top:4px}`,
  // Decisions: each question with a recommendation box.
  `.qs{display:grid;gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.q{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,4fr);gap:32px;align-items:start;padding:30px 32px 32px;background:var(--bg-soft)}`,
  `.q h3{font-size:22px;line-height:1.25;letter-spacing:-.02em;margin-bottom:10px}`,
  `.q p{max-width:60ch;font-size:16.5px}.q .chg .lab{margin-right:8px}`,
  `.q .rec{padding:18px 20px;border-radius:var(--radius);background:var(--accent-soft);color:var(--ink)}`,
  `.q .rec b{display:block;margin-bottom:4px;color:var(--accent);font-size:13.5px;font-weight:600}.q .rec strong{font-size:20px;line-height:1.3;letter-spacing:-.01em}`,
  // Evidence and log: ledgers, a rule between rows.
  `.ledger,.log{display:grid}`,
  `.ev{display:grid;grid-template-columns:160px minmax(0,1.6fr) minmax(0,1fr);gap:8px 28px;align-items:baseline;padding:22px 0;border-top:1px solid var(--line)}.ev:first-child,.log li:first-child{border-top:0}`,
  `.ev b{color:var(--ink);font-weight:600;line-height:1.35}.ev .cl{display:grid;gap:4px}.ev .pr{color:var(--muted);font-size:15px}.ev .rs{font:600 15px/1.4 var(--font);color:var(--ink)}`,
  `.badge{display:inline-flex;align-items:center;gap:8px;justify-self:start;color:var(--c);font:600 13.5px/1.3 var(--font)}`,
  `.ev-verified{--c:var(--ok);--cb:var(--ok-bg)}.ev-inferred{--c:var(--warn);--cb:var(--warn-bg)}.ev-guess{--c:var(--muted);--cb:var(--bg-soft)}`,
  `.log li{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px 28px;padding:18px 0;border-top:1px solid var(--line)}.log time{font:600 14px/1.6 var(--font);color:var(--muted)}.log li>span{color:var(--ink)}`,
  // Risks: a table.
  `.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:16.5px}`,
  `th{font:600 13.5px/1.3 var(--font);color:var(--muted);text-align:left;padding:0 20px 12px 0;border-bottom:1px solid var(--ink)}`,
  `td{text-align:left;vertical-align:top;border-top:1px solid var(--line);padding:18px 20px 18px 0;color:var(--body)}td:first-child{color:var(--ink);font-weight:600}`,
  `tbody tr:first-child td{border-top:0}`,
  // Links.
  `.links{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:2px;border-radius:var(--radius);overflow:hidden}`,
  `.links li{background:var(--bg-soft)}.links a{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:20px 24px;color:var(--ink);font-weight:600;text-decoration:none}.links a:hover{text-decoration:underline}`,
  // Footer.
  `.foot{margin-top:112px;padding-block:44px}.foot p{font-size:14px;color:var(--muted)}`,
  // The slide deck.
  `.deck{display:none}`,
  `html.present{font-size:1.12em}`,
  `html.present [data-slide]{display:none}`,
  `html.present [data-slide].cur{display:block;min-height:calc(100vh - 150px)}`,
  `html.present .banner.cur{display:grid;align-content:center}`,
  `html.present .part{padding-top:56px}`,
  `html.present .foot,html.present .top .links,html.present .top .sep,html.present .top .stamp{display:none}`,
  `html.present .deck{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;gap:12px;align-items:center;justify-content:center;padding:10px;border-top:1px solid var(--line)}`,
  `html.present .deck span{font:600 14px var(--font);color:var(--muted)}`,
  // A phone: panels stack, the bar keeps only the title, the state, present and the switch.
  `@media (max-width:860px){.own,.facts,.q,.estep,.diff,.ev,.log li,.idea{grid-template-columns:minmax(0,1fr)}.q{gap:18px}.idea .centre{order:-1;grid-column:1;grid-row:auto}.idea .branch:nth-child(n){grid-column:1}.estep{gap:12px}.estep .no{font-size:56px}`,
  `.part{padding-top:64px}.hero{padding-block:40px}.figure{margin-top:36px}.foot{margin-top:80px}.sh{margin-bottom:26px}.own .nx,.own .stop{padding:26px 22px}.opt{padding:26px 22px 28px}.q{padding:24px 22px 26px}.ba{padding:24px 22px}`,
  `.top .links,.top .sep,.top .stamp{display:none}.top .wrap{gap:10px}.top .ttl{max-width:none;flex:1 1 auto}.top nav{margin-left:0;flex:none}`,
  `.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.stack,.stack tbody,.stack tr,.stack td{display:block;width:100%}.stack tr{padding:14px 0;border-top:1px solid var(--line)}.stack tbody tr:first-child{border-top:0;padding-top:0}.stack td{border:0;padding:3px 0}`,
  `.stack td[data-label]::before{content:attr(data-label);display:block;font:600 13px/1.3 var(--font);color:var(--muted);margin-bottom:2px}}`,
  `@media (max-width:520px){body{font-size:16px}#present{display:none}.tile{padding:22px 20px}.steps{grid-template-columns:minmax(0,1fr)}.say{grid-template-columns:minmax(0,1fr)}}`,
  // Motion is an extra: the hero rises and the owner's gate glows only when the reader has not asked for less.
  `@media (prefers-reduced-motion:no-preference){.gate .halo{animation:heat 2.6s ease-in-out infinite;transform-origin:center;transform-box:fill-box}@keyframes heat{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1.12)}}.hero h1,.hero .lede,.figure{animation:rise .7s cubic-bezier(.22,1,.36,1) both}.hero .lede{animation-delay:.08s}.figure{animation-delay:.16s}@keyframes rise{from{opacity:.001;transform:translateY(20px)}}}`,
  `@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}`,
  // Print: the final state, light on paper, one slide after another.
  `@media print{body{background:#fff;color:#000}.top,.deck,.js-only,.say{display:none}.slab,.win,.pull{--slab:#fff;--slab-2:#f1f1f1;--slab-3:#e6e6e6;--slab-ink:#000;--slab-body:#222;--slab-muted:#444;--hot:#5a3600;--hot-ink:#fff;--hot-glow:transparent;--ok:#0f5c2a;--warn:#7a4504;--bad:#9a1d17;--info:#164a9e;background-image:none}`,
  `.fig{overflow:visible;display:block!important}.path,.path-detail{display:none!important}.steps{display:block}.js .steps .explain{display:block}[data-slide]{display:block!important;break-inside:avoid}.banner{break-after:page}.fig.playing .edge path{animation:none}.focus .node:not(.on),.focus .edge:not(.on){opacity:1}}`,
].join('\n');

export class Assets {
  /**
   * The page's stylesheet: the project tokens, the fixed state colours, then the shell and every kind. Light and dark by
   * variables, no image, no font file, the final state in print and under reduced motion.
   */
  static pageCss(opts: { tokens: string }): string {
    return `${opts.tokens}\n${STATE_CSS}\n${BASE_CSS}`;
  }
}

/** The first script of the page, run before the stylesheet is used: marks the page as scripted and applies the saved theme, so there is no flash. */
export const HEAD_JS = `(()=>{const r=document.documentElement;r.classList.add('js');try{const s=localStorage.getItem('vz-theme');if(s==='dark'||s==='light')r.setAttribute('data-theme',s)}catch(e){}})();`;

/** The page's script: the theme switch, detail on hover or focus, the steps, and the presentation mode. Text is set with textContent only. */
export const PAGE_JS = `(()=>{
const d=document,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>[...r.querySelectorAll(s)],root=d.documentElement;
const tb=q('#theme');
if(tb){
const mq=matchMedia('(prefers-color-scheme: dark)'),tip=q('.tip',tb);
const dark=()=>{const t=root.dataset.theme;return t?t==='dark':mq.matches};
const paint=()=>{const w=dark()?tb.dataset.toLight:tb.dataset.toDark;tb.setAttribute('aria-label',w);if(tip)tip.textContent=w};
const flip=()=>{const n=dark()?'light':'dark';root.dataset.theme=n;try{localStorage.setItem('vz-theme',n)}catch(e){}paint()};
paint();
mq.addEventListener('change',paint);
tb.onclick=()=>{
if(matchMedia('(prefers-reduced-motion: reduce)').matches){flip();return}
if(d.startViewTransition){d.startViewTransition(flip);return}
root.classList.add('theme-fade');flip();setTimeout(()=>root.classList.remove('theme-fade'),260)};
}
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
const fig=q('#flow .fig'),say=q('#say'),hint=say?say.textContent:'',all=q('#all');
let at=-1;
const note=t=>{if(say)say.textContent=t};
qa('[data-node]').forEach(n=>{const on=()=>{if(at<0)note(n.dataset.detail)};n.addEventListener('mouseenter',on);n.addEventListener('focus',on)});
const pp=q('#play');
if(pp&&fig)pp.onclick=()=>{const on=fig.classList.toggle('playing');pp.textContent=on?pp.dataset.pause:pp.dataset.play;pp.setAttribute('aria-pressed',String(on))};
const raw=q('#steps'),btns=qa('#flow .steps button');
if(raw&&fig){
const steps=JSON.parse(raw.textContent);
const go=i=>{at=i;qa('.on',fig).forEach(x=>x.classList.remove('on'));
btns.forEach((b,k)=>b.setAttribute('aria-pressed',String(k===i)));
fig.classList.toggle('focus',i>=0);
if(all)all.hidden=i<0;
if(i<0){note(hint);return}
const s=steps[i];
s.nodes.forEach(id=>q('[data-node="'+id+'"]',fig)?.classList.add('on'));
s.edges.forEach(id=>q('[data-edge="'+id+'"]',fig)?.classList.add('on'));
note(s.note)};
btns.forEach((b,k)=>b.addEventListener('click',()=>go(at===k?-1:k)));
if(all)all.onclick=()=>go(-1);
}
})();`;
