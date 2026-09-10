import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const WRITE_TOKEN = () => process.env.WORKER_TOKEN ?? "";
function assertWorker(token: string) {
  if (!WRITE_TOKEN() || token !== WRITE_TOKEN()) throw new Error("Unauthorized.");
}

/** The rubric the worker grades with. Public read so the report page can show rule text. */
export const active = query({
  args: {},
  handler: async (ctx) => {
    const r = await ctx.db.query("rubric").withIndex("by_active", (q) => q.eq("active", true)).first();
    return r ? { version: r.version, rules: r.rules, note: r.note } : null;
  },
});

export const byVersion = query({
  args: { version: v.string() },
  handler: async (ctx, { version }) => {
    const r = await ctx.db.query("rubric").withIndex("by_version", (q) => q.eq("version", version)).first();
    return r ? { version: r.version, rules: r.rules, note: r.note } : null;
  },
});

/** Publish a rubric version and make it active. Re-publishing the same version replaces its rules. */
export const publish = mutation({
  args: { token: v.string(), version: v.string(), rules: v.any(), note: v.optional(v.string()) },
  handler: async (ctx, { token, version, rules, note }) => {
    assertWorker(token);
    const now = Date.now();
    for (const r of await ctx.db.query("rubric").withIndex("by_active", (q) => q.eq("active", true)).take(10)) await ctx.db.patch(r._id, { active: false, updatedAt: now });
    const existing = await ctx.db.query("rubric").withIndex("by_version", (q) => q.eq("version", version)).first();
    if (existing) { await ctx.db.patch(existing._id, { rules, note, active: true, updatedAt: now }); return existing._id; }
    return await ctx.db.insert("rubric", { version, rules, note, active: true, updatedAt: now });
  },
});
