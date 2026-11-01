/**
 * The look of the sequence, the lifecycle and the tree. Colours come from the page's tokens only: the figures sit on the
 * always-dark slab (their own background, so they read the same whatever the section around them does), the phone
 * lists sit on the page ground. Nothing here names a colour of a project.
 */
export const NEW_KINDS_CSS = `.kfig{margin:0}
.kfig figcaption{margin-top:14px;max-width:70ch;color:var(--muted);font-size:15px;line-height:1.5}
.kf{display:block;max-width:100%;height:auto;background:var(--slab);border:1px solid var(--slab-3);color:var(--slab-ink);border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.kf text{fill:var(--slab-body);font-size:12px}
.kf .kt{fill:var(--slab-ink);font-size:14px;font-weight:600;letter-spacing:-.01em}
.kf .ks{fill:var(--slab-muted);font-size:12px}
.kf .kw{fill:var(--slab-muted);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.kf .ke{fill:var(--slab-body);font-size:13px}
.kf .knum{fill:var(--slab-muted);font-weight:600}
.kf .kh{paint-order:stroke;stroke:var(--slab);stroke-width:8px;stroke-linejoin:round}
.kf .kbox{fill:var(--slab-2);stroke:var(--slab-3);stroke-width:1}
.kf .kk-start .kbox{stroke:var(--slab-ink);stroke-width:2}
.kf .kk-end .kbox{stroke:var(--slab-muted);stroke-width:1.5}
.kf .kinner{fill:none;stroke:var(--slab-muted);stroke-width:1.5}
.kf .kline{fill:none;stroke:var(--slab-body);stroke-width:1.8}
.kf .kdash{stroke-dasharray:7 5}
.kf .khead{fill:var(--slab-body);stroke:none}
.kf .kopen{fill:none;stroke:var(--slab-body);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.kf .klife{fill:none;stroke:var(--slab-muted);stroke-width:1;stroke-dasharray:1 5;stroke-linecap:round}
.kf .kdot{fill:var(--slab-ink)}
.kf .kguide{fill:none;stroke:var(--slab-muted);stroke-width:1.5}
.kf .kic{color:var(--slab-ink)}
.kf .kn-blocked .kbox{stroke:var(--slab-ink);stroke-width:2}
.kf .kn-waiting .kbox,.kf .kn-in-progress .kbox{stroke:var(--slab-body);stroke-width:1.5}
.kf .kn-not-started .kbox,.kf .kn-dropped .kbox{stroke:var(--slab-muted);stroke-dasharray:4 4}
.path.kl{display:none}
.path.kl,.path.kl ul,.path.kl ol{margin:0;padding:0;list-style:none}
.path.kl li{display:block;border:0;padding:10px 0;color:var(--body);font-size:16px;line-height:1.5}
.path.kl li+li{border-top:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.path.kl b{color:var(--ink);font-weight:600}
.path.kl .mut{color:var(--muted)}
.path.kl .verb{display:inline-block;margin:0 8px;padding:0 8px;border:1px solid color-mix(in srgb,var(--ink) 35%,transparent);border-radius:4px;color:var(--body);font-size:14px;line-height:1.6}
.path.kl .kv-reply{border-style:dashed}
.path.kl .kv-async{border-left-width:4px}
.path.kl .kword{color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.path.kl .knote{display:block;margin-top:2px;color:var(--muted);font-size:14px}
.path.kl .kparts{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.path.kl .kparts li,.path.kl .kparts li+li{padding:3px 0;border:0}
.path.kl .kmsgs{padding-left:28px;list-style:decimal}
.path.kl .kmsgs li{display:list-item}
.path.kl .kmsgs li::marker{color:var(--muted);font-weight:600}
.path.kl .kout{margin:4px 0 0 14px}
.path.kl .kout li,.path.kl .kout li+li{padding:3px 0;border:0}
.path.kl .kout .verb{margin-left:0}
.path.kl .kt-in{margin:8px 0 0 6px;padding-left:16px;border-left:2px solid color-mix(in srgb,var(--ink) 18%,transparent)}
.path.kl .kt-in li{padding:6px 0}
.path.kl .kt-in li+li{border-top:0}
.path.kl .chip{margin-left:6px;vertical-align:middle}
`;
