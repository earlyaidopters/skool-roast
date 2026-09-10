import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const status = v.union(v.literal("queued"), v.literal("fetching"), v.literal("grading"), v.literal("rendering"), v.literal("done"), v.literal("failed"));
const roast = v.union(v.literal("light"), v.literal("dark"));

export default defineSchema({
  /** Slim row: what the progress page subscribes to. Stays under ~1 KB. */
  audits: defineTable({
    slug: v.string(),
    inputUrl: v.string(),
    roast: v.optional(roast),
    status,
    stage: v.optional(v.string()),
    error: v.optional(v.string()),
    score: v.optional(v.number()),
    ownerFirstName: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    rubricVersion: v.optional(v.string()),
    verdictsFrom: v.optional(v.union(v.literal("fresh"), v.literal("cache"))),
    previousScore: v.optional(v.number()),
    pageChanged: v.optional(v.boolean()),
    screenshotId: v.optional(v.id("_storage")),
    annotatedId: v.optional(v.id("_storage")),
    idealId: v.optional(v.id("_storage")),
    coverIdeaId: v.optional(v.id("_storage")),
    analyzeVideo: v.optional(v.boolean()),
    videoClipId: v.optional(v.id("_storage")),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // legacy fat fields, migrated into `reports`; kept optional so old rows still validate
    about: v.optional(v.any()),
    report: v.optional(v.any()),
    verdicts: v.optional(v.any()),
    captureStats: v.optional(v.any()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_slug", ["slug", "createdAt"]),

  /** Fat payload: one row per audit, read once when the roast is done. */
  reports: defineTable({
    auditId: v.id("audits"),
    about: v.optional(v.any()),
    report: v.optional(v.any()),
    verdicts: v.optional(v.any()),
    captureStats: v.optional(v.any()),
    video: v.optional(v.any()),
    updatedAt: v.number(),
  }).index("by_audit", ["auditId"]),

  /** Gemini observations per video URL, so a re-run never rewatches the same VSL. */
  videoCache: defineTable({
    urlHash: v.string(),
    url: v.string(),
    observations: v.any(),
    clipId: v.optional(v.id("_storage")),
    model: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_hash", ["urlHash"]),

  /** Single-row operational state shared by every worker (Codex cooldown). */
  codexState: defineTable({
    key: v.string(),
    cooldownUntil: v.number(),
    reason: v.optional(v.string()),
    strikes: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Published rubric versions; the worker grades with the active one. */
  rubric: defineTable({
    version: v.string(),
    rules: v.any(),
    note: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_version", ["version"])
    .index("by_active", ["active"]),
});
