/**
 * Local worker: polls Convex for queued audits and runs the pipeline.
 *   light: fetch About -> quick grade
 *   dark:  fetch About -> screenshot -> grade -> redline -> ideal mock -> upload
 * Run with: npm run worker
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { fetchSkoolAbout } from "../src/lib/skool.ts";
import { captureAbout, renderHtml } from "./capture.mts";
import { annotate } from "./annotate.mts";
import { idealHtml } from "./ideal.mts";
import { gradeDark, gradeLight, generateCover, judgeRules, loadRules, scoreFromVerdicts, setActiveRubric, root, type Verdict } from "./grade.mts";
import { createHash } from "node:crypto";
import { CodexGate, RateLimitError, sleep } from "./codex-gate.mts";
import { setCodexGate, setWaitHook } from "./grade.mts";
import type { SkoolAbout } from "../src/lib/skool.ts";
import { analyzeVideo, videoBlock, type VideoObservations, type VideoResult } from "./video.mts";

const envFile = await readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
const env = (k: string) => process.env[k] ?? envFile.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
const convexUrl = env("ROAST_CONVEX_URL") ?? env("NEXT_PUBLIC_CONVEX_URL");
const token = env("WORKER_TOKEN") ?? "";
if (!convexUrl || !token) throw new Error("ROAST_CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) and WORKER_TOKEN are required in .env.local");
const model = env("ROAST_CODEX_MODEL") ?? "gpt-5.6-sol";
const reasoning = env("ROAST_CODEX_REASONING") ?? "medium";
const withCover = env("ROAST_COVER_IMAGE") === "1";
const pollMs = Number(env("ROAST_POLL_MS") ?? 4000);
const concurrency = Math.max(1, Number(env("ROAST_CONCURRENCY") ?? 3));
const turnsPerMinute = Math.max(1, Number(env("ROAST_CODEX_TURNS_PER_MIN") ?? 12));
const fakeRateLimit = env("ROAST_FAKE_RATELIMIT") === "1";
const vslEnabled = env("ROAST_VSL") === "1";
const geminiKey = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY") ?? "";
const geminiModel = env("ROAST_GEMINI_MODEL") ?? "gemini-3.8-flash";
const storeClips = env("ROAST_VSL_STORE") === "1";
const workerId = `${process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local"}-${process.pid}`;

const convex = new ConvexHttpClient(convexUrl);
const gate = new CodexGate(turnsPerMinute, {
  getCooldownUntil: async () => ((await convex.query(api.codex.state, {})) as { cooldownUntil: number }).cooldownUntil,
  reportRateLimit: async (reason) => (await convex.mutation(api.codex.reportRateLimit, { token, reason })) as { cooldownUntil: number; minutes: number; strikes: number },
  clearCooldown: async () => { await convex.mutation(api.codex.clearCooldown, { token }); },
}, fakeRateLimit);
setCodexGate(gate);
type Id = string & { __tableName: "audits" };
type Job = { _id: Id; slug: string; inputUrl: string; roast?: "light" | "dark"; analyzeVideo?: boolean };
let stopping = false;
let active = 0;
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { console.log(`${sig} received, finishing ${active} active roast(s) then exiting`); stopping = true; if (active === 0) process.exit(0); });

/** Fetch the About page with retries (Skool occasionally 5xx's or rate-limits). */
async function fetchWithRetry(url: string, tries = 3) {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try { return await fetchSkoolAbout(url); } catch (err) { last = err; if (/No Skool community|did not load as a community|Could not read/.test(String((err as Error).message))) throw err; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

/** Hash of the editable surfaces only; Skool UI counts never affect it. */
function contentHash(a: SkoolAbout, rubricVersion: string) {
  const parts = [rubricVersion, a.displayName, a.headline, a.body, a.coverUrl ?? "", a.videoUrl ?? "", String(a.attachmentCount), ...a.imageAttachments];
  return createHash("sha256").update(parts.join("")).digest("hex").slice(0, 16);
}

async function upload(bytes: Buffer, contentType = "image/png"): Promise<string> {
  const url = await convex.mutation(api.audits.uploadUrl, { token });
  const res = await fetch(url, { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(bytes) });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return ((await res.json()) as { storageId: string }).storageId;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function patch(id: Id, fields: Record<string, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await convex.mutation(api.audits.update, { token, id: id as any, ...fields });
}

/** Run a Codex-backed step; on a rate limit, wait out the shared cooldown and retry in place (never fails the job). */
async function withCodexRetry<T>(id: Id, label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      // a silent or timed-out Codex turn is a stall, not a verdict: retry on a fresh thread (twice)
      const stalled = /no progress event|timed out|timeout/i.test(String((err as Error).message ?? err));
      if (stalled && attempt <= 2) {
        console.warn(`[${label}] Codex stalled (${(err as Error).message}); retrying on a fresh thread (attempt ${attempt})`);
        await patch(id, { stage: "Codex stalled, starting that step again" });
        await sleep(3000);
        continue;
      }
      if (!(err instanceof RateLimitError) || attempt > 6) throw err;
      const secs = Math.max(5, Math.ceil((err.cooldownUntil - Date.now()) / 1000));
      console.warn(`[${label}] ${err.message}; waiting ${secs}s then retrying (attempt ${attempt})`);
      // heartbeat every 30s so the janitor never requeues a job that is just waiting
      const deadline = err.cooldownUntil + 500;
      while (Date.now() < deadline) {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        await patch(id, { stage: `Codex is busy, resuming in about ${left < 90 ? `${left} seconds` : `${Math.ceil(left / 60)} minutes`}` });
        await sleep(Math.min(30_000, deadline - Date.now()));
      }
    }
  }
}

async function runAudit(job: Job) {
  const id = job._id;
  setWaitHook(async (seconds, why) => { if (seconds >= 8) await patch(id, { stage: why === "cooldown" ? `Codex is busy, resuming in about ${seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}` : `Pacing Codex, next turn in ${seconds}s` }); });
  const mode = job.roast ?? "dark";
  const dir = path.join(root, "runtime", String(id));
  await mkdir(dir, { recursive: true });
  try {
    const about = await fetchWithRetry(job.inputUrl);
    const { rules, version: rubricVersion } = await loadRules();
    const hash = contentHash(about, rubricVersion);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = (await convex.query(api.audits.previousForSlug, { token, slug: job.slug, excludeId: id as any })) as { contentHash?: string; verdicts?: Verdict[] | null; score?: number | null; roast?: string } | null;
    const pageChanged = prev ? prev.contentHash !== hash : false;
    // reuse verdicts only when the page is unchanged and the previous audit had at least as much evidence (dark covers light)
    const canReuse = Boolean(prev && !pageChanged && prev.verdicts && (prev.roast === "dark" || mode === "light"));
    await patch(id, { about, contentHash: hash, rubricVersion, ownerFirstName: about.ownerFirstName, previousScore: prev?.score ?? undefined, pageChanged });

    if (mode === "light") {
      await patch(id, { status: "grading", stage: canReuse ? "Light roast: page unchanged, reusing your checklist" : "Light roast: running the checklist" });
      const verdicts = canReuse ? (prev!.verdicts as Verdict[]) : await withCodexRetry(id, job.slug, () => judgeRules(about, null, { model, eventsPath: path.join(dir, "verdict-events.jsonl") }));
      const scored = scoreFromVerdicts(rules, verdicts);
      await patch(id, { verdicts, verdictsFrom: canReuse ? "cache" : "fresh", stage: "Light roast: writing the notes" });
      const report = await withCodexRetry(id, job.slug, () => gradeLight(about, { score: scored.score, failed: scored.failedRules, verdicts }, { model, reasoning, eventsPath: path.join(dir, "codex-events.jsonl") }));
      report.score = scored.score;
      await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
      await patch(id, { report, status: "done", stage: "Done", finishedAt: Date.now() });
      console.log(`[${job.slug}] light done, score ${report.score}`);
      return;
    }

    await patch(id, { stage: "Taking a screenshot" });
    const cap = await captureAbout(about.url, { displayName: about.displayName, headline: about.headline, bodyStart: about.body });
    const shotPath = path.join(dir, "about.png");
    await writeFile(shotPath, cap.png);
    await writeFile(path.join(dir, "capture.json"), JSON.stringify({ cover: cap.cover, media: cap.media, blocks: cap.blocks }, null, 2));
    const screenshotId = await upload(cap.png);
    const captureStats = { blocks: cap.blocks.length, bodyBlocks: cap.blocks.filter((b) => b.key === "body").length, media: cap.media.length, cover: Boolean(cap.cover), width: cap.width, height: cap.height };
    console.log(`[${job.slug}] capture`, JSON.stringify(captureStats));
    await patch(id, { screenshotId, captureStats });

    // Opt-in VSL pass. Never fails the roast; a skipped video is reported as such.
    let video: VideoResult | null = null;
    if (job.analyzeVideo) {
      if (!vslEnabled) video = { status: "skipped", url: about.videoUrl, reason: "Video analysis is switched off right now." };
      else {
        await patch(id, { stage: "Watching your video" });
        video = await analyzeVideo(about.videoUrl ? { url: about.videoUrl, lengthMs: about.videoLengthMs } : null, dir, {
          apiKey: geminiKey, model: geminiModel,
          cacheGet: async (h) => (await convex.query(api.audits.videoCacheGet, { token, urlHash: h })) as { observations: VideoObservations; model: string | null } | null,
          cachePut: async (h, url, observations, m) => { await convex.mutation(api.audits.videoCachePut, { token, urlHash: h, url, observations, model: m }); },
          onStage: async (st) => { await patch(id, { stage: st }); },
        });
        if (video.status === "analyzed" && video.clipPath && storeClips) {
          try { await patch(id, { videoClipId: await upload(await readFile(video.clipPath)) }); } catch (err) { console.warn(`[${job.slug}] clip upload failed:`, (err as Error).message); }
        }
        console.log(`[${job.slug}] video ${video.status}${video.status === "analyzed" ? ` (${video.from})` : `: ${video.reason}`}`);
      }
      const { clipPath: _c, ...stored } = video as VideoResult & { clipPath?: string };
      await patch(id, { video: stored });
    }
    const vb = video ? videoBlock(video) : "";
    // a fresh video pass means the cached verdicts (judged without it) are stale
    const reuseVerdicts = canReuse && !(video && video.status === "analyzed");
    await patch(id, { status: "grading", stage: reuseVerdicts ? "Dark roast: page unchanged, reusing your checklist" : "Dark roast: running the checklist" });

    const verdicts = reuseVerdicts ? (prev!.verdicts as Verdict[]) : await withCodexRetry(id, job.slug, () => judgeRules(about, shotPath, { model, eventsPath: path.join(dir, "verdict-events.jsonl"), videoBlock: vb }));
    const scored = scoreFromVerdicts(rules, verdicts);
    await patch(id, { verdicts, verdictsFrom: reuseVerdicts ? "cache" : "fresh", stage: "Dark roast: writing the roast" });
    const report = await withCodexRetry(id, job.slug, () => gradeDark(about, shotPath, { score: scored.score, failed: scored.failedRules, verdicts }, { model, reasoning, eventsPath: path.join(dir, "codex-events.jsonl"), videoBlock: vb }));
    report.score = scored.score;
    await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
    await patch(id, { report, status: "rendering", stage: "Redlining your page" });

    const { png: annotated, located } = await annotate(cap, report.issues);
    await writeFile(path.join(dir, "annotated.png"), annotated);
    const annotatedId = await upload(annotated);
    await patch(id, { annotatedId, report: { ...report, located }, stage: "Building the ideal version" });

    const idealPng = await renderHtml(idealHtml(report.ideal, { name: about.displayName, coverUrl: about.coverUrl, members: about.totalMembers }));
    await writeFile(path.join(dir, "ideal.png"), idealPng);
    const idealId = await upload(idealPng);
    await patch(id, { idealId });

    if (withCover) {
      await patch(id, { stage: "Generating a cover concept" });
      const coverPath = path.join(dir, "cover.png");
      if (await generateCover(report.cover_image_prompt, coverPath, { model, reasoning })) {
        await patch(id, { coverIdeaId: await upload(await readFile(coverPath)) });
      }
    }
    await patch(id, { status: "done", stage: "Done", finishedAt: Date.now() });
    console.log(`[${job.slug}] dark done, score ${report.score}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.error(`[${job.slug}] failed:`, message);
    await patch(id, { status: "failed", error: message, stage: "Failed", finishedAt: Date.now() });
  }
}

console.log(`Skool Roast worker ${workerId} up. Model ${model} (${reasoning}), concurrency ${concurrency}, ${turnsPerMinute} Codex turns/min${fakeRateLimit ? ", FAKE RATE LIMIT ON" : ""}, cover images ${withCover ? "on" : "off"}. Polling ${convexUrl}`);

async function slot(n: number) {
  for (;;) {
    if (stopping) return;
    try {
      const job = (await convex.mutation(api.audits.claim, { token, workerId: `${workerId}#${n}` })) as Job | null;
      if (job) {
        active += 1;
        console.log(`[${job.slug}] claimed by slot ${n} (${job.roast})`);
        try { await runAudit(job); } finally {
          if (env("ROAST_KEEP_RUNTIME") !== "1") await rm(path.join(root, "runtime", String(job._id)), { recursive: true, force: true }).catch(() => {});
          active -= 1; if (stopping && active === 0) { console.log("drained, exiting"); process.exit(0); } }
        continue; // look for more work immediately
      }
    } catch (err) {
      console.error(`slot ${n} error:`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, pollMs + Math.random() * 1000));
  }
}

async function rubricRefresher() {
  for (;;) {
    try {
      const r = (await convex.query(api.rubric.active, {})) as { version: string; rules: never[] } | null;
      if (r) { setActiveRubric(r as never); }
    } catch (err) { console.error("rubric refresh error:", (err as Error).message); }
    await new Promise((res) => setTimeout(res, 5 * 60_000));
  }
}

async function janitor() {
  for (;;) {
    try {
      const r = (await convex.mutation(api.audits.requeueStale, { token })) as { requeued: number; failed: number };
      if (r.requeued || r.failed) console.log(`janitor: requeued ${r.requeued}, failed ${r.failed}`);
    } catch (err) { console.error("janitor error:", (err as Error).message); }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

try { const r = (await convex.query(api.rubric.active, {})) as { version: string; rules: never[] } | null; if (r) { setActiveRubric(r as never); console.log(`rubric ${r.version} loaded from Convex`); } else console.log("no rubric in Convex, using repo file"); } catch (err) { console.error("rubric load error, using repo file:", (err as Error).message); }
void rubricRefresher();
void janitor();
await Promise.all(Array.from({ length: concurrency }, (_, i) => slot(i + 1)));
console.log("clean exit");
process.exit(0);
