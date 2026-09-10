/**
 * Share card: one clean PNG per roast, rendered on demand from the stored report.
 * Works for every roast ever run, no worker involved. Used by the Share section
 * on the report page and as the Open Graph image for /r/<id>.
 */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { scoreColor } from "@/lib/score";

export const runtime = "nodejs";

const INK = "#17171c", CREAM = "#fff8ec", MUTED = "#6f6f78";
const SEV: Record<string, string> = { high: "#e2482f", medium: "#eab04b", low: "#4db5f2" };
const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

type Note = { title: string; fix: string; severity?: string };
type Report = { score?: number; verdict?: string; summary?: string; issues?: Array<Note & { severity: string }>; notes?: Note[] };

/** Fonts are vendored next to this file (woff, Satori reads them directly), so Vercel never depends on Google at request time. */
const FONT_DIR = path.join(process.cwd(), "src", "app", "r", "[id]", "card", "fonts");
const fontCache = new Map<string, Promise<ArrayBuffer>>();
function localFont(file: string): Promise<ArrayBuffer> {
  if (!fontCache.has(file)) fontCache.set(file, readFile(path.join(FONT_DIR, file)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
  return fontCache.get(file)!;
}

/** Fold unicode bold/italic (𝗕𝗼𝗹𝗱) to plain letters the vendored fonts can draw, then trim to n chars on a word boundary. */
const clip = (raw: string, n: number) => {
  const s = (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new Response("Missing NEXT_PUBLIC_CONVEX_URL", { status: 500 });
  const client = new ConvexHttpClient(convexUrl);
  const audit = await client.query(api.audits.status, { id: id as Id<"audits"> }).catch(() => null);
  if (!audit) return new Response("No roast found.", { status: 404 });
  if (audit.status !== "done") return new Response("Still cooking.", { status: 409 });
  const payload = await client.query(api.audits.report, { id: id as Id<"audits"> });
  const report = (payload?.report ?? null) as Report | null;
  if (!report) return new Response("No report.", { status: 404 });

  const mode = audit.roast === "light" ? "light" : "dark";
  const score = typeof report.score === "number" ? report.score : (audit.score ?? 0);
  const c = scoreColor(score);
  const raw: Note[] = mode === "dark" ? (report.issues ?? []) : (report.notes ?? []);
  const top = raw
    .map((n, i) => ({ ...n, i }))
    .sort((a, b) => (SEV_RANK[a.severity ?? "low"] ?? 2) - (SEV_RANK[b.severity ?? "low"] ?? 2) || a.i - b.i)
    .slice(0, 3);
  const remaining = raw.length - top.length;

  const [display, body, bodySemi] = await Promise.all([localFont("bricolage-800.woff"), localFont("plex-400.woff"), localFont("plex-600.woff")]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: CREAM, padding: 44, fontFamily: "Plex", color: INK }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 30, letterSpacing: -1 }}>
            <span style={{ color: "#2b2fb8" }}>s</span><span style={{ color: "#e2482f" }}>k</span><span style={{ color: "#eab04b" }}>o</span><span style={{ color: "#4db5f2" }}>o</span><span style={{ color: "#e2482f" }}>l</span>
            <span style={{ marginLeft: 8 }}>roast</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 600, color: MUTED }}>
            <span style={{ display: "flex", padding: "4px 12px", border: `2px solid ${INK}`, borderRadius: 999, background: "#fff", color: INK, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>{mode} roast</span>
            skool.com/{audit.slug}
          </div>
        </div>

        {/* body */}
        <div style={{ display: "flex", flex: 1, gap: 40, marginTop: 34, alignItems: "stretch" }}>
          {/* score */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 250, border: `3px solid ${INK}`, borderRadius: 24, background: "#fff", boxShadow: `8px 8px 0 ${c.bg}` }}>
            <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 128, lineHeight: 1, color: c.bg === "#eab04b" || c.bg === "#4db5f2" ? INK : c.bg }}>{score}</div>
            <div style={{ display: "flex", fontSize: 14, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: MUTED, marginTop: 6 }}>of 100</div>
            <div style={{ display: "flex", marginTop: 18, padding: "6px 16px", border: `2px solid ${INK}`, borderRadius: 999, background: c.bg, color: c.fg, fontFamily: "Bricolage", fontSize: 16, letterSpacing: 1, textTransform: "uppercase" }}>{c.label}</div>
          </div>

          {/* verdict + notes */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 32, lineHeight: 1.15, letterSpacing: -1 }}>{clip(report.verdict ?? "", 150)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
              {top.map((n, k) => (
                <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 16px", background: "#fff", border: `2px solid ${INK}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 999, background: SEV[n.severity ?? "low"] ?? "#4db5f2", color: n.severity === "medium" || n.severity === "low" || !n.severity ? INK : "#fff", fontFamily: "Bricolage", fontSize: 16, flexShrink: 0 }}>{k + 1}</div>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", fontWeight: 600, fontSize: 20, lineHeight: 1.2 }}>{clip(n.title, 70)}</div>
                    <div style={{ display: "flex", fontSize: 16, lineHeight: 1.35, color: "#3a3a44", marginTop: 2 }}>{clip(n.fix, 150)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22, fontSize: 15, color: MUTED }}>
          <span>{remaining > 0 ? `${remaining} more note${remaining === 1 ? "" : "s"}${mode === "dark" ? ", the redlined page," : ""} and the clip behind each one at` : "Full report, with the clip behind each note, at"}</span>
          <span style={{ fontWeight: 600, color: INK }}>skoolroast.vercel.app/r/{id}</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Bricolage", data: display, weight: 800, style: "normal" },
        { name: "Plex", data: body, weight: 400, style: "normal" },
        { name: "Plex", data: bodySemi, weight: 600, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    },
  );
}
