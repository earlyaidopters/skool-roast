/**
 * Screenshot a Skool About page and locate the EDITABLE surfaces so the
 * annotator can redline them: cover/media, sidebar name + headline, and every
 * paragraph of the About body (each with its own box, so copy can be redlined
 * line by line). Skool UI (buttons, prices, reviews, counts) is never boxed.
 */
import { chromium } from "playwright";

export type Box = { x: number; y: number; w: number; h: number };
export type TextBlock = { key: "name" | "sidebar_headline" | "body"; text: string; box: Box };
export type Capture = {
  png: Buffer;
  width: number;
  height: number;
  cover?: Box; // sidebar cover image
  media: Box[]; // main media frame + attachment thumbnails, in order
  blocks: TextBlock[];
};

export async function captureAbout(url: string, hints: { displayName: string; headline: string; bodyStart: string }): Promise<Capture> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const script = String.raw`((h) => {
      const rect = (el) => { if (!el) return undefined; const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return undefined; return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; };
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const all = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,span,div,li"));
      const leaf = (el) => !Array.from(el.children).some((c) => norm(c.textContent).length > 12);
      const out = { blocks: [], media: [] };
      // sidebar: the card on the right that repeats the community name + short description
      const nameEls = all.filter((el) => norm(el.textContent) === norm(h.displayName) && leaf(el)).map((el) => ({ el, r: rect(el) })).filter((x) => x.r);
      const sideName = nameEls.sort((a, b) => b.r.x - a.r.x)[0];
      if (sideName) out.blocks.push({ key: "name", text: norm(sideName.el.textContent), box: sideName.r });
      const headNeedle = norm(h.headline).slice(0, 40).toLowerCase();
      if (headNeedle) {
        const cand = all.filter((el) => leaf(el) && norm(el.textContent).toLowerCase().startsWith(headNeedle)).map((el) => ({ el, r: rect(el) })).filter((x) => x.r).sort((a, b) => b.r.x - a.r.x)[0];
        if (cand) out.blocks.push({ key: "sidebar_headline", text: norm(cand.el.textContent), box: cand.r });
      }
      // sidebar cover: skool asset image inside the right column
      const imgs = Array.from(document.querySelectorAll("img")).map((img) => ({ img, r: rect(img) })).filter((x) => x.r && /assets\.skool\.com|cdn|loom|ytimg|vimeo/.test(x.img.src));
      const cover = imgs.filter((x) => x.r.x > 800 && x.r.w > 200).sort((a, b) => a.r.y - b.r.y)[0];
      if (cover) out.cover = cover.r;
      // main media frame + thumbnails in the left column
      const main = Array.from(document.querySelectorAll("iframe,video,img")).map((el) => ({ el, r: rect(el) })).filter((x) => x.r && x.r.x < 800 && x.r.w > 400 && x.r.h > 180).sort((a, b) => a.r.y - b.r.y)[0];
      if (main) out.media.push(main.r);
      const thumbs = imgs.filter((x) => x.r.x < 800 && x.r.w > 50 && x.r.w < 200 && x.r.h > 40 && x.r.h < 160).sort((a, b) => a.r.x - b.r.x).slice(0, 6);
      for (const t of thumbs) out.media.push(t.r);
      // about body: Skool renders lpDescription as a container with one div per line.
      // Match the container with whitespace stripped (the DOM runs lines together), then box each leaf line.
      const squash = (t) => (t || "").replace(/\s+/g, "").toLowerCase();
      const bodyKey = squash(h.bodyStart).slice(0, 40);
      let bodyEl = null;
      if (bodyKey) {
        const fullLen = squash(h.bodyStart).length;
        const cands = Array.from(document.querySelectorAll("div,p,section")).filter((el) => { const t = squash(el.textContent); return t.startsWith(bodyKey) && t.length >= fullLen * 0.8; }).map((el) => ({ el, r: rect(el) })).filter((x) => x.r && x.r.x < 800 && x.r.w > 300);
        cands.sort((a, b) => a.el.textContent.length - b.el.textContent.length);
        bodyEl = cands[0] ? cands[0].el : null;
      }
      if (bodyEl) {
        const leaves = Array.from(bodyEl.querySelectorAll("*")).filter((el) => leaf(el) && norm(el.textContent).length >= 3);
        const seenY = new Set();
        for (const el of leaves) {
          const r = rect(el); if (!r) continue;
          const k = Math.round(r.y) + ":" + norm(el.textContent).slice(0, 20); if (seenY.has(k)) continue; seenY.add(k);
          out.blocks.push({ key: "body", text: norm(el.textContent), box: r });
        }
      }
      // attachment thumbnails: small tiles right under the main media (img or background-image)
      const tiles = Array.from(document.querySelectorAll("img,div,button,a")).map((el) => ({ el, r: rect(el) })).filter((x) => x.r && x.r.x < 800 && x.r.w > 50 && x.r.w < 200 && x.r.h > 40 && x.r.h < 160 && main && x.r.y > main.r.y + main.r.h - 4 && x.r.y < main.r.y + main.r.h + 60)
        .filter((x) => x.el.tagName === "IMG" || getComputedStyle(x.el).backgroundImage !== "none" || x.el.querySelector("img,video"));
      const seenX = new Set();
      for (const t of tiles.sort((a, b) => a.r.x - b.r.x)) { const k = Math.round(t.r.x / 20); if (seenX.has(k)) continue; seenX.add(k); if (out.media.length < 7) out.media.push(t.r); }
      return out;
    })(${JSON.stringify(hints)})`;
    const found = (await page.evaluate(script)) as { blocks: TextBlock[]; media: Box[]; cover?: Box };
    const png = await page.screenshot({ fullPage: true, type: "png" });
    const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    return { png, width: dims.w, height: dims.h, cover: found.cover, media: found.media, blocks: found.blocks };
  } finally {
    await browser.close();
  }
}

/** Render an HTML string to a PNG (used for the ideal page mock). */
export async function renderHtml(html: string, width = 1280): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(300);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await browser.close();
  }
}
