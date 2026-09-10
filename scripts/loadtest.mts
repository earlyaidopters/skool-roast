/**
 * Concurrency load test against the prod queue.
 *   npx tsx scripts/loadtest.mts --slugs makerschool,earlyaidopters,... --mode mixed --n 6
 * Creates N audits as fast as possible (bypassing dedupe by alternating slugs), then polls
 * until all finish, printing per-job timings and a summary. Fails loudly on any failed job,
 * duplicate claim, or job older than the timeout.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = await readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
const env = (k: string) => process.env[k] ?? envFile.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? "true"] : [])).filter((x) => x.length));
const slugs = String(args.slugs ?? "makerschool,earlyaidopters").split(",");
const n = Number(args.n ?? 6);
const mode = String(args.mode ?? "mixed");
const timeoutMs = Number(args.timeout ?? 20 * 60_000);
const convex = new ConvexHttpClient(env("ROAST_CONVEX_URL") ?? env("NEXT_PUBLIC_CONVEX_URL")!);
const token = env("WORKER_TOKEN")!;

type Row = { id: string; slug: string; roast: string; createdAt: number };
const rows: Row[] = [];
const t0 = Date.now();
for (let i = 0; i < n; i += 1) {
  const slug = slugs[i % slugs.length];
  const roast = mode === "mixed" ? (i % 2 ? "light" : "dark") : mode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = (await convex.mutation(api.audits.create, { slug, inputUrl: `https://www.skool.com/${slug}/about`, roast: roast as any })) as unknown as string;
  rows.push({ id, slug, roast, createdAt: Date.now() });
}
const unique = new Set(rows.map((r) => r.id));
console.log(`created ${rows.length} requests in ${Date.now() - t0}ms, ${unique.size} distinct audits (dedupe collapsed ${rows.length - unique.size})`);

const done = new Map<string, { status: string; score: number | null; secs: number; claimedBy?: string; error?: string }>();
while (done.size < unique.size && Date.now() - t0 < timeoutMs) {
  for (const id of unique) {
    if (done.has(id)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (await convex.query(api.audits.get, { id: id as any })) as any;
    if (a && (a.status === "done" || a.status === "failed")) {
      done.set(id, { status: a.status, score: a.report?.score ?? null, secs: Math.round(((a.finishedAt ?? Date.now()) - (a.startedAt ?? a.createdAt)) / 1000), claimedBy: a.claimedBy, error: a.error });
      console.log(`${a.status.padEnd(6)} ${a.slug.padEnd(16)} ${(a.roast ?? "dark").padEnd(5)} score=${String(a.report?.score ?? "-").padEnd(3)} ${done.get(id)!.secs}s  slot=${a.claimedBy ?? "?"}${a.error ? "  error=" + a.error : ""}`);
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}
const failed = [...done.values()].filter((d) => d.status === "failed").length;
const pending = unique.size - done.size;
const slots = new Set([...done.values()].map((d) => d.claimedBy));
console.log(`\nsummary: ${done.size}/${unique.size} finished in ${Math.round((Date.now() - t0) / 1000)}s, ${failed} failed, ${pending} still pending, ${slots.size} distinct worker slots used`);
process.exit(failed || pending ? 1 : 0);
