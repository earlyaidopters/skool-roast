/**
 * Redline the About page screenshot: numbered callouts on the exact copy lines,
 * cover, sidebar headline, or media an issue points at. No legend in the image;
 * the report page carries the text.
 */
import sharp from "sharp";
import type { Box, Capture } from "./capture.mts";

export type Target = "cover" | "name" | "sidebar_headline" | "body" | "media" | "attachment" | "general";
export type Issue = {
  target: Target;
  quote: string; // exact words from the page this points at ("" for cover/media/general)
  slot?: number; // for attachment: 1 = main video, 2..6 = thumbnails
  severity: "high" | "medium" | "low";
  title: string;
  roast: string; // the playful one-liner
  detail: string;
  fix: string;
  source: { video_title: string; video_url: string; timestamp: string; speaker: string };
};

const COLORS = { high: "#e2482f", medium: "#eab04b", low: "#4db5f2" };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Find the box for an issue: match its quote against captured text blocks. */
export function locate(cap: Capture, iss: Issue): { box: Box; kind: "text" | "media" } | undefined {
  if (iss.target === "cover" && cap.cover) return { box: cap.cover, kind: "media" };
  if (iss.target === "media") return cap.media[0] ? { box: cap.media[0], kind: "media" } : undefined;
  if (iss.target === "attachment") { const i = Math.max(1, iss.slot ?? 1) - 1; return cap.media[i] ? { box: cap.media[i], kind: "media" } : undefined; }
  if (iss.target === "name") { const b = cap.blocks.find((b) => b.key === "name"); return b ? { box: b.box, kind: "text" } : undefined; }
  if (iss.target === "sidebar_headline") { const b = cap.blocks.find((b) => b.key === "sidebar_headline"); return b ? { box: b.box, kind: "text" } : undefined; }
  if (iss.target === "body") {
    const q = norm(iss.quote);
    if (!q) return undefined;
    const bodies = cap.blocks.filter((b) => b.key === "body");
    let best = bodies.find((b) => norm(b.text) === q) ?? bodies.find((b) => norm(b.text).includes(q)) ?? bodies.find((b) => q.includes(norm(b.text)) && b.text.length > 12);
    if (!best) {
      // fuzzy: most shared words
      const qw = new Set(q.split(" ").filter((w) => w.length > 3));
      let top = 0;
      for (const b of bodies) {
        const n = norm(b.text).split(" ").filter((w) => qw.has(w)).length;
        if (n > top && n >= 3) { top = n; best = b; }
      }
    }
    return best ? { box: best.box, kind: "text" } : undefined;
  }
  return undefined;
}

export async function annotate(cap: Capture, issues: Issue[]): Promise<{ png: Buffer; located: boolean[] }> {
  const maxH = Math.min(cap.height, 3000);
  const overlay: string[] = [];
  const used: Box[] = [];
  const located: boolean[] = [];
  issues.forEach((iss, i) => {
    const n = i + 1;
    const hit = locate(cap, iss);
    const color = COLORS[iss.severity];
    if (!hit || hit.box.y > maxH) { located.push(false); return; }
    located.push(true);
    const b = hit.box;
    const pad = hit.kind === "text" ? 4 : 6;
    if (hit.kind === "text") {
      // translucent highlighter + underline, like a redline on copy
      overlay.push(`<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" rx="6" fill="${color}" fill-opacity="0.16"/>`);
      overlay.push(`<line x1="${b.x}" y1="${b.y + b.h + 2}" x2="${b.x + b.w}" y2="${b.y + b.h + 2}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`);
    } else {
      overlay.push(`<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" rx="10" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="14 8"/>`);
    }
    let bx = Math.max(4, b.x - 46);
    let by = Math.max(4, b.y - 6);
    for (const u of used) if (Math.abs(u.x - bx) < 40 && Math.abs(u.y - by) < 40) by = u.y + 42;
    used.push({ x: bx, y: by, w: 36, h: 36 });
    overlay.push(
      `<circle cx="${bx + 18}" cy="${by + 18}" r="18" fill="${color}" stroke="#17171c" stroke-width="3"/>` +
        `<text x="${bx + 18}" y="${by + 25}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="800" fill="#fff">${n}</text>`,
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cap.width}" height="${maxH}">${overlay.join("\n")}</svg>`;
  const png = await sharp(cap.png).extract({ left: 0, top: 0, width: cap.width, height: maxH }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  return { png, located };
}
