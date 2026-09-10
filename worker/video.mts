/**
 * Opt-in VSL analysis for dark roasts.
 *   pick first video attachment -> cache check -> (YouTube: pass URL | else: yt-dlp + ffmpeg 3-min 480p clip -> Gemini Files API)
 *   -> Gemini structured observations -> cache.
 * Every failure returns { skipped: reason } so the roast never fails because of the video.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sleep } from "./codex-gate.mts";

const run = promisify(execFile);

export type VideoObservations = {
  hook_transcript: string;
  opens_with_promise: boolean;
  format: "talking_head" | "screen_share" | "mixed" | "b_roll" | "slides";
  shows_result_or_inside: boolean;
  has_direct_cta: boolean;
  captions_present: boolean;
  captions_readable_on_phone: boolean;
  production_quality: "low" | "ok" | "high";
  structure_seen: Array<"promise" | "pain" | "proof" | "whats_inside" | "objections" | "urgency" | "cta">;
  summary: string;
};
export type VideoResult =
  | { status: "analyzed"; url: string; lengthMs?: number; analyzedSeconds: number; from: "cache" | "fresh"; model: string; observations: VideoObservations; clipPath?: string }
  | { status: "skipped"; url?: string; reason: string };

export const MAX_SECONDS = 180;
const MAX_SOURCE_MS = 12 * 60_000; // longer than 12 min: skip, not a VSL
const MAX_CLIP_BYTES = 40 * 1024 * 1024;

export function videoHash(url: string) { return createHash("sha256").update(url.trim()).digest("hex").slice(0, 24); }

const SCHEMA = {
  type: "OBJECT",
  properties: {
    hook_transcript: { type: "STRING", description: "What is said in the first 15 seconds, verbatim or close" },
    opens_with_promise: { type: "BOOLEAN", description: "Does the first 30 seconds state the outcome a member gets" },
    format: { type: "STRING", enum: ["talking_head", "screen_share", "mixed", "b_roll", "slides"] },
    shows_result_or_inside: { type: "BOOLEAN", description: "Shows the actual thing (classroom, calls, wins, demo) rather than only a person talking" },
    has_direct_cta: { type: "BOOLEAN", description: "Ends with a clear ask to join" },
    captions_present: { type: "BOOLEAN" },
    captions_readable_on_phone: { type: "BOOLEAN" },
    production_quality: { type: "STRING", enum: ["low", "ok", "high"] },
    structure_seen: { type: "ARRAY", items: { type: "STRING", enum: ["promise", "pain", "proof", "whats_inside", "objections", "urgency", "cta"] } },
    summary: { type: "STRING", description: "Two sentences on what the video does and its biggest miss. Plain words, no em dashes." },
  },
  required: ["hook_transcript", "opens_with_promise", "format", "shows_result_or_inside", "has_direct_cta", "captions_present", "captions_readable_on_phone", "production_quality", "structure_seen", "summary"],
};
const QUESTION = `You are auditing the main video (VSL) on a Skool community About page. Only the first ${MAX_SECONDS} seconds are provided. Answer strictly from what you see and hear. If the video is cut off before a call to action, judge has_direct_cta as false.`;

type Deps = {
  apiKey: string;
  model: string;
  cacheGet: (hash: string) => Promise<{ observations: VideoObservations; model: string | null } | null>;
  cachePut: (hash: string, url: string, obs: VideoObservations, model: string) => Promise<void>;
  onStage?: (s: string) => Promise<void>;
};

const isYouTube = (u: string) => /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(u);
/** Hosts we know how to fetch. Anything else is skipped up front with a clear message, never a crash. */
const KNOWN_HOSTS = [/(^|\.)loom\.com$/, /(^|\.)youtube\.com$/, /^youtu\.be$/, /(^|\.)vimeo\.com$/, /(^|\.)wistia\.(com|net)$/, /(^|\.)skool\.com$/, /(^|\.)cloudfront\.net$/, /(^|\.)mux\.com$/];
function preflight(url: string): string | null {
  let h: string;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return "The video link on the About page isn't a web address we can open."; h = u.hostname.replace(/^www\./, ""); }
  catch { return "The video link on the About page isn't a web address we can open."; }
  if (/\.(mp4|m3u8|webm|mov)(\?|$)/i.test(url)) return null;
  if (!KNOWN_HOSTS.some((re) => re.test(h))) return `We don't support videos hosted on ${h} yet, so this roast graded the page without watching it. Loom and YouTube work best.`;
  return null;
}

export async function analyzeVideo(attachment: { url: string; lengthMs?: number } | null, dir: string, deps: Deps): Promise<VideoResult> {
  if (!attachment?.url) return { status: "skipped", reason: "No video attached to the About page." };
  const { url, lengthMs } = attachment;
  if (!deps.apiKey) return { status: "skipped", url, reason: "Video analysis is not configured on this worker." };
  if (lengthMs && lengthMs > MAX_SOURCE_MS) return { status: "skipped", url, reason: `Your video is ${Math.round(lengthMs / 60_000)} minutes long. We only watch videos under 12 minutes, so this roast graded the page without it.` };
  const pre = preflight(url);
  if (pre) return { status: "skipped", url, reason: pre };

  const hash = videoHash(url);
  try {
    const cached = await deps.cacheGet(hash);
    if (cached?.observations) return { status: "analyzed", url, lengthMs, analyzedSeconds: MAX_SECONDS, from: "cache", model: cached.model ?? deps.model, observations: cached.observations };
  } catch (err) { console.warn("video cache read failed:", (err as Error).message); }

  try {
    let part: Record<string, unknown>;
    let clipPath: string | undefined;
    if (isYouTube(url)) {
      part = { fileData: { fileUri: url }, videoMetadata: { startOffset: "0s", endOffset: `${MAX_SECONDS}s`, fps: 0.5 } };
    } else {
      await deps.onStage?.("Watching your video: downloading");
      clipPath = await downloadClip(url, dir);
      await deps.onStage?.("Watching your video: uploading");
      const uri = await uploadToGemini(clipPath, deps.apiKey);
      part = { fileData: { fileUri: uri, mimeType: "video/mp4" }, videoMetadata: { fps: 0.5 } };
    }
    await deps.onStage?.("Watching your video: taking notes");
    const observations = await askGemini(part, deps.apiKey, deps.model);
    try { await deps.cachePut(hash, url, observations, deps.model); } catch (err) { console.warn("video cache write failed:", (err as Error).message); }
    return { status: "analyzed", url, lengthMs, analyzedSeconds: Math.min(MAX_SECONDS, Math.round((lengthMs ?? MAX_SECONDS * 1000) / 1000)), from: "fresh", model: deps.model, observations, clipPath };
  } catch (err) {
    const raw = (err as Error).message ?? String(err);
    console.warn(`video analysis skipped: ${raw.split("\n").slice(-1)[0]}`);
    return { status: "skipped", url, reason: friendlyReason(raw, url) };
  }
}

function friendlyReason(raw: string, url: string): string {
  let host = "the video host";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  const tail = " We graded the page without it.";
  if (/vimeo\.com$/.test(host)) return "We can't fetch Vimeo videos right now. Loom and YouTube work best." + tail;
  if (/private|password|logged-in|OAuth|401|403|members only/i.test(raw)) return `The video on ${host} is private or needs a login, so we couldn't watch it.` + tail;
  if (/404|not found|unavailable|removed|deleted/i.test(raw)) return `The video link on ${host} looks broken or removed.` + tail;
  if (/yt-dlp|ffmpeg|Unsupported URL|HTTP Error|ETIMEDOUT|timed out|socket/i.test(raw)) return `We couldn't fetch the video from ${host}. Loom and YouTube work best right now.` + tail;
  if (/over the 40 MB/.test(raw)) return "The video file was too large to analyze." + tail;
  if (/could not process|no answer|FAILED/i.test(raw)) return "The video model couldn't read this file." + tail;
  if (/Gemini|429|503/.test(raw)) return "The video model was busy. Run the roast again in a few minutes for the video notes." + tail;
  return "Something went wrong while watching the video." + tail;
}

/** yt-dlp full source at <=720p (Loom HLS refuses section cuts), then ffmpeg to a 480p clip of the first MAX_SECONDS. */
async function downloadClip(url: string, dir: string): Promise<string> {
  const full = path.join(dir, "video-full.mp4");
  const clip = path.join(dir, "video-clip.mp4");
  await run("yt-dlp", ["-q", "--no-warnings", "--no-playlist", "--socket-timeout", "20", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4", "-o", full, url], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  await run("ffmpeg", ["-v", "error", "-y", "-i", full, "-t", String(MAX_SECONDS), "-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", clip], { timeout: 120_000 });
  const size = (await stat(clip)).size;
  if (size > MAX_CLIP_BYTES) throw new Error(`Clip is ${Math.round(size / 1e6)} MB, over the 40 MB limit.`);
  return clip;
}

async function uploadToGemini(clipPath: string, apiKey: string): Promise<string> {
  const bytes = await readFile(clipPath);
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": "video/mp4", "Content-Type": "application/json" },
    body: JSON.stringify({ file: { display_name: path.basename(clipPath) } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start failed (${start.status}).`);
  const fin = await fetch(uploadUrl, { method: "POST", headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
  if (!fin.ok) throw new Error(`Gemini upload failed (${fin.status}).`);
  const file = (await fin.json()).file as { name: string; uri: string; state: string };
  for (let i = 0; i < 20; i += 1) {
    if (file.state === "ACTIVE") return file.uri;
    await sleep(3000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`);
    const j = (await r.json()) as { state: string; uri: string };
    if (j.state === "ACTIVE") return j.uri;
    if (j.state === "FAILED") throw new Error("Gemini could not process the video.");
  }
  throw new Error("Gemini took too long to process the video.");
}

async function askGemini(part: Record<string, unknown>, apiKey: string, model: string): Promise<VideoObservations> {
  const body = { contents: [{ parts: [part, { text: QUESTION }] }], generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW", responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 } };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (r.status === 429 || r.status === 503) { last = `Gemini ${r.status}`; await sleep(4000 * (attempt + 1)); continue; }
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message ?? `Gemini error ${r.status}`);
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no answer.");
    return JSON.parse(text) as VideoObservations;
  }
  throw new Error(last || "Gemini unavailable.");
}

/** Text block injected into the Codex prompts. */
export function videoBlock(v: VideoResult | null | undefined): string {
  if (!v) return "";
  if (v.status === "skipped") return `\n=== MAIN VIDEO (VSL) ===\nNot analyzed: ${v.reason} Judge video rules from the thumbnail and page data only.`;
  const o = v.observations;
  return `\n=== MAIN VIDEO (VSL), watched by a model, first ${v.analyzedSeconds}s ===
Source: ${v.url}${v.lengthMs ? ` (${Math.round(v.lengthMs / 1000)}s long)` : ""}
Opens with the outcome promise: ${o.opens_with_promise ? "yes" : "NO"}
Format: ${o.format.replace("_", " ")}; shows the real thing (classroom, calls, wins, demo) instead of only a person talking: ${o.shows_result_or_inside ? "yes" : "NO"}
Structure seen: ${o.structure_seen.length ? o.structure_seen.join(", ") : "none of promise/pain/proof/inside/objections/urgency/cta"}
Direct ask to join: ${o.has_direct_cta ? "yes" : "NO"}; captions: ${o.captions_present ? (o.captions_readable_on_phone ? "present and readable on a phone" : "present but NOT readable on a phone") : "none"}; production: ${o.production_quality}
First 15 seconds, spoken: "${o.hook_transcript}"
Summary: ${o.summary}
Use these facts for the video rules (R26, R27, R28, R29, R62, R63) and the slot 1 verdict. Quote the hook when you roast it.`;
}
