/** Push knowledge/rubric.json to Convex as the active rubric: npx tsx scripts/publish-rubric.mts [--prod] */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = await readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
const env = (k: string) => process.env[k] ?? envFile.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
const prod = process.argv.includes("--prod");
const url = prod ? env("ROAST_CONVEX_URL") : env("NEXT_PUBLIC_CONVEX_URL");
if (!url) throw new Error("missing Convex URL");
const rubric = JSON.parse(await readFile(path.join(root, "knowledge/rubric.json"), "utf8"));
const convex = new ConvexHttpClient(url);
await convex.mutation(api.rubric.publish, { token: env("WORKER_TOKEN")!, version: rubric.version, rules: rubric.rules, note: rubric.note });
console.log(`published rubric ${rubric.version} (${rubric.rules.length} rules) to ${url}`);
