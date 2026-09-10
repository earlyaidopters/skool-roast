/**
 * Render the "ideal" About page: the editable surfaces only, rewritten.
 * Sidebar card (cover + name + headline) and the About body with unicode bold.
 */
export type IdealCopy = {
  sidebar_headline: string;
  about_body: string; // plain text with line breaks; may contain unicode bold
  cover_direction: string;
  media_plan: Array<{ slot: number; current: string; action: "keep" | "replace" | "remove" | "add"; should_show: string }>;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function idealHtml(c: IdealCopy, o: { name: string; coverUrl?: string; members: number }) {
  const paras = c.about_body.split(/\n{2,}|\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p)}</p>`).join("");
  const plan = [...c.media_plan].sort((a, b) => a.slot - b.slot).filter((m) => m.action !== "remove").slice(0, 6);
  const media = plan.slice(1).map((m) => `<div class="thumb"><span>${m.slot} · ${m.action}</span>${esc(m.should_show)}</div>`).join("");
  const cover = o.coverUrl ? `<img class="cover" src="${esc(o.coverUrl)}" alt="">` : `<div class="cover ph">Cover</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#202124}
  .wrap{max-width:1180px;margin:24px auto;display:grid;grid-template-columns:1fr 340px;gap:24px;padding:0 20px}
  .card{background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .badge{display:inline-block;background:#17171c;color:#fff;font-size:12px;padding:4px 10px;border-radius:999px;margin-bottom:14px;letter-spacing:.04em}
  h1{font-size:28px;margin:0 0 14px}
  .mainmedia{height:300px;border-radius:12px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;padding:20px;text-align:center;margin-bottom:12px}
  .thumbs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:22px}
  .thumb{background:#eef1f5;border-radius:8px;padding:8px;font-size:11px;line-height:1.3;min-height:70px;position:relative}
  .thumb span{display:block;font-weight:800;color:#e2482f;margin-bottom:2px}
  p{font-size:16px;line-height:1.55;margin:0 0 12px;white-space:pre-wrap}
  .side h2{font-size:20px;margin:12px 0 6px} .side .head{font-size:15px;line-height:1.45;color:#333}
  .cover{width:100%;height:190px;object-fit:cover;border-radius:12px;background:#e8e8e8}
  .ph{display:flex;align-items:center;justify-content:center;color:#888}
  .dir{margin-top:14px;font-size:12px;color:#555;background:#fbf7ef;border-radius:8px;padding:10px}
  .stats{display:flex;gap:16px;color:#555;font-size:13px;margin-top:12px} .stats b{display:block;font-size:17px;color:#111}
  </style></head><body><div class="wrap">
  <div class="card"><span class="badge">IDEAL VERSION · EDITABLE SURFACES ONLY</span>
    <h1>${esc(o.name)}</h1>
    <div class="mainmedia">${esc(plan[0]?.should_show ?? "Main video: promise, pain, proof, what's inside, objections, CTA")}</div>
    <div class="thumbs">${media}</div>
    ${paras}
  </div>
  <div class="card side">${cover}
    <div class="dir"><b>Cover direction:</b> ${esc(c.cover_direction)}</div>
    <h2>${esc(o.name)}</h2><div class="head">${esc(c.sidebar_headline)}</div>
    <div class="stats"><div><b>${o.members.toLocaleString()}</b>Members</div></div>
  </div>
  </div></body></html>`;
}
