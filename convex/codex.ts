import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const WRITE_TOKEN = () => process.env.WORKER_TOKEN ?? "";
function assertWorker(token: string) {
  if (!WRITE_TOKEN() || token !== WRITE_TOKEN()) throw new Error("Unauthorized.");
}

/** Current Codex cooldown, shared across all worker containers. Public so the page can show it. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("codexState").withIndex("by_key", (q) => q.eq("key", "codex")).first();
    const now = Date.now();
    return { cooldownUntil: row?.cooldownUntil ?? 0, active: (row?.cooldownUntil ?? 0) > now, reason: row?.reason, strikes: row?.strikes ?? 0 };
  },
});

/** A worker hit a rate limit: back off with escalating cooldown (1, 2, 5, 10 min cap). */
export const reportRateLimit = mutation({
  args: { token: v.string(), reason: v.string() },
  handler: async (ctx, { token, reason }) => {
    assertWorker(token);
    const now = Date.now();
    const row = await ctx.db.query("codexState").withIndex("by_key", (q) => q.eq("key", "codex")).first();
    // strikes decay: if the last strike was over 30 minutes ago, start over
    const strikes = row && now - row.updatedAt < 30 * 60_000 ? row.strikes + 1 : 1;
    const minutes = [1, 2, 5, 10][Math.min(strikes, 4) - 1];
    const cooldownUntil = Math.max(row?.cooldownUntil ?? 0, now + minutes * 60_000);
    if (row) await ctx.db.patch(row._id, { cooldownUntil, reason, strikes, updatedAt: now });
    else await ctx.db.insert("codexState", { key: "codex", cooldownUntil, reason, strikes, updatedAt: now });
    return { cooldownUntil, minutes, strikes };
  },
});

/** A Codex turn succeeded after a cooldown: clear it. */
export const clearCooldown = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    assertWorker(token);
    const row = await ctx.db.query("codexState").withIndex("by_key", (q) => q.eq("key", "codex")).first();
    if (row && row.cooldownUntil > Date.now()) await ctx.db.patch(row._id, { cooldownUntil: Date.now(), updatedAt: Date.now() });
  },
});
