/**
 * The look of the compare view, the sources and the terms. Colours come from the page's tokens only. An arrow that only the
 * second version has is heavy and solid, one that only the first has is dotted, a shared one is plain: the line style and a
 * word tell them apart, never the colour. Appended after the page's own stylesheet, so these rules win on equal weight.
 */
export const COMPARE_CSS = `.edge.added path{stroke:var(--ink);stroke-width:4.5}
.edge.added text{fill:var(--ink);font-weight:700}
.edge.removed path{stroke-dasharray:1 7;stroke-linecap:round;stroke-width:3}
.legend .edge.added path{stroke-width:4.5}
.legend .edge.removed path{stroke-width:3}
.cmp-key{margin-top:18px}
.path.cmp .cg{margin:22px 0 8px;color:var(--ink);font:650 15px/1.3 var(--font)}
.path.cmp .cg:first-child{margin-top:0}
.path.cmp .cg.added{padding-left:10px;border-left:4px solid var(--ink)}
.path.cmp .cg.removed{padding-left:10px;border-left:3px dotted var(--ink)}
.path.cmp ol{margin:0;padding:0}
.verb.added{border:2px solid var(--ink);color:var(--ink);font-weight:600}
.verb.removed{border:2px dotted var(--ink);color:var(--ink)}
.src{font:500 13px/1.5 var(--code);color:var(--muted);overflow-wrap:anywhere}
.path-detail .src,.explain .src{display:block;margin-top:4px}
.srcs{border-top:1px solid var(--line)}
.srcs li{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,2fr);gap:6px 36px;align-items:baseline;padding:18px 0;border-bottom:1px solid var(--line)}
.srcs .src{color:var(--ink);font-size:14px}
.srcs .by{color:var(--body);font-size:15.5px}
.terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:2px;margin:0;border-radius:var(--radius);overflow:hidden}
.terms div{display:grid;align-content:start;padding:26px 26px 30px;background:var(--bg-soft)}
@supports (grid-template-rows:subgrid){.terms div{grid-template-rows:subgrid;grid-row-end:span 2}}
.terms dt{color:var(--ink);font-size:19px;font-weight:650;letter-spacing:-.02em;margin-bottom:10px}
.terms dd{margin:0;max-width:52ch;color:var(--body);font-size:16px}
@media (max-width:700px){.srcs li{grid-template-columns:minmax(0,1fr)}.terms div{padding:22px 22px 26px}}
`;
