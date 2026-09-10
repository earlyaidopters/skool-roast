import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";

const WRITE_TOKEN = () => process.env.WORKER_TOKEN ?? "";
function assertWorker(token: string) {
  if (!WRITE_TOKEN() || token !== WRITE_TOKEN()) throw new Error("Unauthorized worker.");
}
async function reportRow(ctx: QueryCtx | MutationCtx, auditId: Id<"audits">) {
  return await ctx.db.query("reports").withIndex("by_audit", (q) => q.eq("auditId", auditId)).first();
}

export const create = mutation({
  args: { slug: v.string(), inputUrl: v.string(), roast: v.optional(v.union(v.literal("light"), v.literal("dark"))), analyzeVideo: v.optional(v.boolean()) },
  handler: async (ctx, { slug, inputUrl, roast, analyzeVideo }) => {
    const now = Date.now();
    const mode = roast ?? "dark";
    const wantVideo = mode === "dark" && analyzeVideo === true; // light roasts never watch video
    const recent = await ctx.db.query("audits").withIndex("by_slug", (q) => q.eq("slug", slug).gt("createdAt", now - 10 * 60_000)).order("desc").take(10);
    const live = recent.find((r) => (r.roast ?? "dark") === mode && Boolean(r.analyzeVideo) === wantVideo && r.status !== "done" && r.status !== "failed");
    if (live) return live._id;
    // abuse guards: one community can't be roasted more than 6 times in 10 minutes, and the queue has a ceiling
    if (recent.length >= 6) throw new Error("That community was just roasted several times. Give it ten minutes, then try again.");
    const queued = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "queued")).take(80);
    if (queued.length >= 60) throw new Error("The grill is full right now. Try again in a few minutes.");
    return await ctx.db.insert("audits", { slug, inputUrl, roast: mode, analyzeVideo: wantVideo, status: "queued", attempts: 0, createdAt: now, updatedAt: now });
  },
});

/** Slim status document for the live progress page (~1 KB). */
export const status = query({
  args: { id: v.id("audits") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a) return null;
    const url = async (sid?: Id<"_storage">) => (sid ? await ctx.storage.getUrl(sid) : null);
    return {
      _id: a._id, slug: a.slug, roast: a.roast ?? "dark", status: a.status, stage: a.stage, error: a.error, score: a.score,
      verdictsFrom: a.verdictsFrom, previousScore: a.previousScore, pageChanged: a.pageChanged, createdAt: a.createdAt, analyzeVideo: a.analyzeVideo ?? false,
      annotatedUrl: await url(a.annotatedId), idealUrl: await url(a.idealId), coverIdeaUrl: await url(a.coverIdeaId), screenshotUrl: await url(a.screenshotId),
    };
  },
});

/** Full payload, read once the roast is done. */
export const report = query({
  args: { id: v.id("audits") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a) return null;
    const r = await reportRow(ctx, id);
    return { report: r?.report ?? a.report ?? null, verdicts: r?.verdicts ?? a.verdicts ?? null, about: r?.about ?? a.about ?? null, video: r?.video ?? null };
  },
});

/** Joined view for scripts and the load test. */
export const get = query({
  args: { id: v.id("audits") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a) return null;
    const r = await reportRow(ctx, id);
    const url = async (sid?: Id<"_storage">) => (sid ? await ctx.storage.getUrl(sid) : null);
    return { ...a, about: r?.about ?? a.about, report: r?.report ?? a.report, verdicts: r?.verdicts ?? a.verdicts, captureStats: r?.captureStats ?? a.captureStats,
      screenshotUrl: await url(a.screenshotId), annotatedUrl: await url(a.annotatedId), idealUrl: await url(a.idealId), coverIdeaUrl: await url(a.coverIdeaId) };
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "done")).order("desc").take(20);
    return rows.map((r) => ({ _id: r._id, slug: r.slug, roast: r.roast ?? "dark", score: r.score ?? r.report?.score ?? null, createdAt: r.createdAt }));
  },
});

/** Paginated history of finished roasts, newest first. */
export const recentPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "done")).order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.map((r) => ({ _id: r._id, slug: r.slug, roast: r.roast ?? "dark", score: r.score ?? r.report?.score ?? null, createdAt: r.createdAt })) };
  },
});

/** Counts per status, for a quick health check. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, number> = {};
    for (const s of ["queued", "fetching", "grading", "rendering", "done", "failed"] as const) {
      out[s] = (await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", s)).take(5000)).length;
    }
    const failed = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "failed")).order("desc").take(10);
    return { counts: out, recentFailures: failed.map((f) => ({ slug: f.slug, error: f.error ?? null, createdAt: f.createdAt })) };
  },
});

export const queuePosition = query({
  args: { id: v.id("audits") },
  handler: async (ctx, { id }) => {
    const me = await ctx.db.get(id);
    if (!me || me.status !== "queued") return { ahead: 0, running: 0 };
    const queued = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "queued")).take(200);
    const ahead = queued.filter((r) => r.createdAt < me.createdAt).length;
    let running = 0;
    for (const s of ["fetching", "grading", "rendering"] as const) running += (await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", s)).take(50)).length;
    return { ahead, running };
  },
});

// ---------------- worker side ----------------
export const claim = mutation({
  args: { token: v.string(), workerId: v.string() },
  handler: async (ctx, { token, workerId }) => {
    assertWorker(token);
    const job = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "queued")).order("asc").first();
    if (!job) return null;
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "fetching", stage: "Reading your About page", claimedBy: workerId, claimedAt: now, startedAt: now, attempts: (job.attempts ?? 0) + 1, updatedAt: now });
    return { _id: job._id, slug: job.slug, inputUrl: job.inputUrl, roast: job.roast ?? "dark", analyzeVideo: job.analyzeVideo ?? false };
  },
});

export const requeueStale = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    assertWorker(token);
    const cutoff = Date.now() - 12 * 60_000;
    let requeued = 0, failed = 0;
    for (const s of ["fetching", "grading", "rendering"] as const) {
      const rows = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", s)).take(50);
      for (const r of rows) {
        if (r.updatedAt > cutoff) continue;
        if ((r.attempts ?? 0) >= 3) { await ctx.db.patch(r._id, { status: "failed", stage: "Failed", error: "The roast stalled three times. Try again in a bit.", updatedAt: Date.now() }); failed += 1; }
        else { await ctx.db.patch(r._id, { status: "queued", stage: "Queued again", claimedBy: undefined, updatedAt: Date.now() }); requeued += 1; }
      }
    }
    return { requeued, failed };
  },
});

/** Worker patch: slim fields go on the audit row, fat fields go to `reports`. */
export const update = mutation({
  args: {
    token: v.string(), id: v.id("audits"),
    status: v.optional(v.string()), stage: v.optional(v.string()), error: v.optional(v.string()),
    score: v.optional(v.number()), ownerFirstName: v.optional(v.string()), contentHash: v.optional(v.string()), rubricVersion: v.optional(v.string()),
    verdictsFrom: v.optional(v.union(v.literal("fresh"), v.literal("cache"))), previousScore: v.optional(v.number()), pageChanged: v.optional(v.boolean()),
    screenshotId: v.optional(v.id("_storage")), annotatedId: v.optional(v.id("_storage")), idealId: v.optional(v.id("_storage")), coverIdeaId: v.optional(v.id("_storage")), videoClipId: v.optional(v.id("_storage")),
    finishedAt: v.optional(v.number()),
    about: v.optional(v.any()), report: v.optional(v.any()), verdicts: v.optional(v.any()), captureStats: v.optional(v.any()), video: v.optional(v.any()),
  },
  handler: async (ctx, { token, id, about, report, verdicts, captureStats, video, ...slim }) => {
    assertWorker(token);
    const now = Date.now();
    const clean = Object.fromEntries(Object.entries(slim).filter(([, x]) => x !== undefined));
    if (report && typeof report.score === "number") (clean as Record<string, unknown>).score = report.score;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(id, { ...(clean as any), updatedAt: now });
    const fat = Object.fromEntries(Object.entries({ about, report, verdicts, captureStats, video }).filter(([, x]) => x !== undefined));
    if (Object.keys(fat).length) {
      const existing = await reportRow(ctx, id);
      if (existing) await ctx.db.patch(existing._id, { ...fat, updatedAt: now });
      else await ctx.db.insert("reports", { auditId: id, ...fat, updatedAt: now });
    }
  },
});

// ---------------- video cache ----------------
export const videoCacheGet = query({
  args: { token: v.string(), urlHash: v.string() },
  handler: async (ctx, { token, urlHash }) => {
    assertWorker(token);
    const row = await ctx.db.query("videoCache").withIndex("by_hash", (q) => q.eq("urlHash", urlHash)).order("desc").first();
    return row ? { observations: row.observations, clipId: row.clipId ?? null, model: row.model ?? null, createdAt: row.createdAt } : null;
  },
});
export const videoCachePut = mutation({
  args: { token: v.string(), urlHash: v.string(), url: v.string(), observations: v.any(), clipId: v.optional(v.id("_storage")), model: v.optional(v.string()) },
  handler: async (ctx, { token, ...row }) => {
    assertWorker(token);
    await ctx.db.insert("videoCache", { ...row, createdAt: Date.now() });
  },
});

export const uploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => { assertWorker(token); return await ctx.storage.generateUploadUrl(); },
});

export const previousForSlug = query({
  args: { token: v.string(), slug: v.string(), excludeId: v.id("audits") },
  handler: async (ctx, { token, slug, excludeId }) => {
    assertWorker(token);
    const rows = await ctx.db.query("audits").withIndex("by_slug", (q) => q.eq("slug", slug)).order("desc").take(10);
    const prev = rows.find((r) => r._id !== excludeId && r.status === "done" && r.contentHash);
    if (!prev) return null;
    const r = await reportRow(ctx, prev._id);
    return { contentHash: prev.contentHash, verdicts: r?.verdicts ?? prev.verdicts ?? null, score: prev.score ?? prev.report?.score ?? null, roast: prev.roast ?? "dark", createdAt: prev.createdAt };
  },
});

/** One-time: move legacy fat fields off audit rows into `reports`. Safe to re-run. */
export const migrateReports = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    assertWorker(token);
    const rows = await ctx.db.query("audits").take(500);
    let moved = 0;
    for (const a of rows) {
      if (!a.about && !a.report && !a.verdicts && !a.captureStats) continue;
      const existing = await reportRow(ctx, a._id);
      const fat = { about: a.about, report: a.report, verdicts: a.verdicts, captureStats: a.captureStats };
      if (existing) await ctx.db.patch(existing._id, { ...fat, updatedAt: Date.now() });
      else await ctx.db.insert("reports", { auditId: a._id, ...fat, updatedAt: Date.now() });
      await ctx.db.patch(a._id, { about: undefined, report: undefined, verdicts: undefined, captureStats: undefined, score: a.score ?? a.report?.score, updatedAt: Date.now() });
      moved += 1;
    }
    return { moved };
  },
});

export const wipeBefore = mutation({
  args: { token: v.string(), before: v.number() },
  handler: async (ctx, { token, before }) => {
    assertWorker(token);
    const rows = await ctx.db.query("audits").take(500);
    let deleted = 0, files = 0;
    for (const r of rows) {
      if (r.createdAt >= before) continue;
      for (const sid of [r.screenshotId, r.annotatedId, r.idealId, r.coverIdeaId]) if (sid) { try { await ctx.storage.delete(sid); files += 1; } catch { /* gone */ } }
      const rep = await reportRow(ctx, r._id);
      if (rep) await ctx.db.delete(rep._id);
      await ctx.db.delete(r._id);
      deleted += 1;
    }
    return { deleted, files };
  },
});

/** Rough wait estimate for a queued or running audit, from recent measured durations. */
export const eta = query({
  args: { id: v.id("audits") },
  handler: async (ctx, { id }) => {
    const me = await ctx.db.get(id);
    if (!me || me.status === "done" || me.status === "failed") return null;
    const recent = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "done")).order("desc").take(30);
    const avg = (mode: string, fallback: number) => {
      const xs = recent.filter((r) => (r.roast ?? "dark") === mode && r.startedAt && r.finishedAt).map((r) => (r.finishedAt! - r.startedAt!) / 1000);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
    };
    const dark = avg("dark", 200), light = avg("light", 70);
    const concurrency = 3;
    let secondsAhead = 0;
    if (me.status === "queued") {
      const queued = await ctx.db.query("audits").withIndex("by_status", (q) => q.eq("status", "queued")).take(200);
      const ahead = queued.filter((r) => r.createdAt < me.createdAt);
      secondsAhead = ahead.reduce((t, r) => t + ((r.roast ?? "dark") === "dark" ? dark : light), 0) / concurrency;
    }
    const mine = (me.roast ?? "dark") === "dark" ? dark : light;
    const elapsed = me.startedAt ? (Date.now() - me.startedAt) / 1000 : 0;
    const cooldown = await ctx.db.query("codexState").withIndex("by_key", (q) => q.eq("key", "codex")).first();
    const cooldownSeconds = cooldown && cooldown.cooldownUntil > Date.now() ? (cooldown.cooldownUntil - Date.now()) / 1000 : 0;
    return { seconds: Math.max(15, Math.round(secondsAhead + Math.max(mine - elapsed, 20) + cooldownSeconds)), cooldownSeconds: Math.round(cooldownSeconds) };
  },
});
