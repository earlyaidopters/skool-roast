/**
 * Grade the EDITABLE surfaces of a Skool About page with the Codex SDK.
 * Dark roast: rubric + structured data + screenshot -> full report with redline targets.
 * Light roast: rubric + structured data only -> quick notes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexThread, runCodexTurn as rawRunCodexTurn } from "./lib/codex-sdk.mjs";
import type { CodexGate } from "./codex-gate.mts";

let gate: CodexGate | null = null;
let onWaitHook: ((seconds: number, why: "cooldown" | "budget") => void | Promise<void>) | undefined;
export function setCodexGate(g: CodexGate) { gate = g; }
export function setWaitHook(h: typeof onWaitHook) { onWaitHook = h; }
/** All Codex turns funnel through here so the throttle and cooldown apply everywhere. */
async function runCodexTurn(opts: Parameters<typeof rawRunCodexTurn>[0]) {
  return gate ? gate.run(() => rawRunCodexTurn(opts), onWaitHook) : rawRunCodexTurn(opts);
}
import type { SkoolAbout } from "../src/lib/skool.ts";
import { renderAboutForModel } from "../src/lib/skool.ts";
import type { Issue } from "./annotate.mts";
import type { IdealCopy } from "./ideal.mts";
import { checkDark, checkLight, scrub } from "./quality.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");

export type DarkReport = { score?: number; quality?: string[]; verdict: string; summary: string; issues: Issue[]; ideal: IdealCopy; cover_image_prompt: string };
export type LightReport = { score?: number; quality?: string[]; verdict: string; summary: string; notes: Array<{ title: string; roast: string; fix: string; source: Issue["source"] }>; rewritten_headline: string };

export type Rule = { id: string; category: string; surface: string; rule: string; check: string; why: string; weight: number; observable: string; sources: Array<{ speaker: string; video_title: string; video_url: string; timestamp: string }> };
export type Verdict = { id: string; verdict: "pass" | "fail" | "skip"; reason: string };

let activeRubric: { version: string; rules: Rule[] } | null = null;
/** Set by the worker after fetching the active rubric from Convex; falls back to the repo file. */
export function setActiveRubric(r: { version: string; rules: Rule[] } | null) { activeRubric = r; }
export async function loadRules(): Promise<{ version: string; rules: Rule[] }> {
  if (activeRubric) return activeRubric;
  return JSON.parse(await readFile(path.join(root, "knowledge/rubric.json"), "utf8"));
}

/** Deterministic score: weighted pass ratio over judged (non-skipped) rules. */
export function scoreFromVerdicts(rules: Rule[], verdicts: Verdict[]): { score: number; judged: number; passed: number; failedRules: Rule[] } {
  const byId = new Map(rules.map((r) => [r.id, r]));
  let judgedW = 0, passedW = 0, judged = 0, passed = 0;
  const failedRules: Rule[] = [];
  for (const v of verdicts) {
    const r = byId.get(v.id);
    if (!r || v.verdict === "skip") continue;
    judged += 1; judgedW += r.weight;
    if (v.verdict === "pass") { passed += 1; passedW += r.weight; } else failedRules.push(r);
  }
  const score = judgedW ? Math.round((100 * passedW) / judgedW) : 0;
  return { score, judged, passed, failedRules: failedRules.sort((a, b) => b.weight - a.weight) };
}

function failedRulesText(failed: Rule[], verdicts: Verdict[]): string {
  const why = new Map(verdicts.map((v) => [v.id, v.reason]));
  if (!failed.length) return "(none failed; say the copy is strong and give 3 polish notes drawn from the highest-weight rules it barely passes)";
  return failed.map((r) => { const src = r.sources[0]; return `${r.id} [weight ${r.weight}, ${r.surface}] ${r.rule}\n   auditor: ${why.get(r.id) ?? ""}\n   source: ${src.speaker}, "${src.video_title}", ${src.video_url}, at ${src.timestamp}`; }).join("\n");
}

function parse<T>(text: string): T {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}

/** Pass 1: one verdict per rule. Low reasoning, checklist only, no roasting. */
export async function judgeRules(about: SkoolAbout, screenshotPath: string | null, opts: { model: string; eventsPath?: string; videoBlock?: string }): Promise<Verdict[]> {
  const { version, rules } = await loadRules();
  const list = rules.map((r) => `${r.id} [weight ${r.weight}, ${r.surface}] ${r.rule}\n   check: ${r.check}`).join("\n");
  const prompt = `You are auditing the EDITABLE surfaces of a Skool About page against a checklist. This is a checklist pass, not a roast: for EVERY rule return pass, fail, or skip. Use skip only when the data truly cannot show it. Be consistent: the same page must get the same verdicts every time. Judge the literal text and visuals, not intent.

${SCOPE}

=== CHECKLIST (${version}) ===
${list}

=== ABOUT PAGE DATA (server-rendered) ===
${renderAboutForModel(about)}
${opts.videoBlock ?? ""}
${screenshotPath ? "\n=== SCREENSHOT ===\nThe attached image is the About page. Use it for cover, main video frame, and thumbnails." : ""}`;
  const { thread } = await createCodexThread({ workingDirectory: root, model: opts.model, reasoning: "low", sandboxMode: "read-only", skipGitRepoCheck: true, isolated: true });
  const input = screenshotPath ? [{ type: "text", text: prompt }, { type: "local_image", path: screenshotPath }] : prompt;
  const { finalResponse } = await runCodexTurn({ thread, prompt: input, outputSchemaPath: path.join(here, "verdict-schema.json"), eventsPath: opts.eventsPath, timeoutMs: 5 * 60_000, idleTimeoutMs: 3 * 60_000 });
  const out = parse<{ verdicts: Verdict[] }>(finalResponse).verdicts;
  const seen = new Set<string>();
  return out.filter((v) => rules.some((r) => r.id === v.id) && !seen.has(v.id) && seen.add(v.id));
}

async function rubricText() {
  const rubric = await loadRules();
  const rules = (rubric.rules as Array<Record<string, unknown>>)
    .map((r) => {
      const s = (r.sources as Array<Record<string, string>>)[0] ?? {};
      return `${r.id} [${r.category} → ${r.surface}, weight ${r.weight}] ${r.rule}\n   check: ${r.check}\n   source: ${s.speaker}, "${s.video_title}", ${s.video_url}, at ${s.timestamp}`;
    })
    .join("\n");
  return { version: rubric.version as string, rules };
}

async function voice(): Promise<string> {
  return await readFile(path.join(root, "knowledge/roast-voice.md"), "utf8").catch(() => "");
}

const STYLE = `HOW TO WRITE IT:
- Address the creator by first name in the verdict or summary when the owner is known ("Hey Nick, ..."). Talk to them, not about them.
- Every note quotes their actual words or names the actual image. Never write a note that could apply to any Skool page.
- Every fix for copy is the replacement line itself, in quotes, ready to paste. Not "make it clearer", not "consider". Write it.
- Roast lines are one specific joke about THEIR page, under 22 words, never mean. Then the fix in plain words.
- Ban these in anything you write or rewrite: "no fluff, just results", "remove the guesswork", "stop overthinking", "unlock your potential", "level up", "game-changer", "transform your", "seamless", "leverage", "empower", "journey", "elevate". No em dashes anywhere.
- Plain sentences, contractions, no corporate tone. Sound like a sharp friend who has read 500 About pages.`;

const SCOPE = `WHAT YOU MAY GRADE (the creator can edit these, nothing else):
- The community display name.
- The sidebar headline (the short description under the name).
- The About body copy (the long text; unicode bold is allowed there, nothing else).
- The sidebar cover image.
- Up to six About attachments: the main video (VSL) and image/video thumbnails.
NEVER grade or mention Skool's own UI: join or trial buttons, pricing tiers, annual billing, reviews, member counts, join questions, levels, categories, classroom. Those are product, not copy. If the only thing wrong is product, say the copy is strong.`;

export async function gradeDark(about: SkoolAbout, screenshotPath: string, ctx: { score: number; failed: Rule[]; verdicts: Verdict[] }, opts: { model: string; reasoning: string; eventsPath?: string; videoBlock?: string }): Promise<DarkReport> {
  const { version, rules } = await rubricText();
  const failedText = failedRulesText(ctx.failed, ctx.verdicts);
  const prompt = `You are Skool Roast, grading the About page of a Skool community for a Skool community owner. Roast it the way an experienced Skool coach does on a Loom: playful, specific, quoting their actual words, always followed by the fix. No em dashes. No flattery. Funny, never cruel.

${await voice()}

${STYLE}

${SCOPE}

Every issue cites its rule's source verbatim (speaker, video title, url, timestamp). Do not invent sources.

The checklist pass is already done. The page scored ${ctx.score}/100. These are the rules it FAILED, with the auditor's reason; build your notes from these and only these (you may merge two into one note, never add a failure that is not listed):
${failedText}

Issues: 3 to 8, ordered by what costs the most members. For target=body, "quote" must be an exact line copied from the About body so it can be redlined on the screenshot. For headline, cover, and media issues, set target accordingly and leave quote empty. Each issue gets a one-line roast and a concrete fix (for copy, write the replacement line).

Attachments: the page has slot 1 (main video) plus up to five thumbnails, left to right, slots 2 to 6. Judge EACH slot that exists and each empty slot: does it earn its place (outcome, proof, what's inside, the person), is it redundant with the cover or another slot, is text legible on mobile. Raise attachment issues with target=attachment and the slot number. Then fill media_plan with one entry per slot 1 to 6 (keep, replace, remove, or add) and what it should show.

Skool limits: the sidebar headline (group description) must be under 150 characters; the About body under 1,000 characters. Respect both in the ideal.

Ideal: rewrite ONLY the sidebar headline and the About body. Keep their niche, voice, and every real fact. Do not invent numbers, testimonials, guarantees, or credentials they did not state. First line of about_body is the headline in unicode bold. Then give cover_direction and a media_plan for up to six attachments.

=== RUBRIC (${version}) ===
${rules}

=== ABOUT PAGE DATA (server-rendered) ===
${renderAboutForModel(about)}
${opts.videoBlock ?? ""}

=== SCREENSHOT ===
The attached image is the About page as a visitor sees it. Use it for the cover, the main video frame, the thumbnails, and how the copy reads above the fold.`;

  const { thread } = await createCodexThread({ workingDirectory: root, model: opts.model, reasoning: opts.reasoning, sandboxMode: "read-only", skipGitRepoCheck: true, isolated: true });
  const { finalResponse } = await runCodexTurn({
    thread,
    prompt: [{ type: "text", text: prompt }, { type: "local_image", path: screenshotPath }],
    outputSchemaPath: path.join(here, "report-schema.json"),
    eventsPath: opts.eventsPath,
    timeoutMs: 8 * 60_000,
    idleTimeoutMs: 4 * 60_000,
  });
  let report = parse<DarkReport>(finalResponse);
  const problems = checkDark(report, about);
  if (problems.length) {
    console.log(`[quality] dark: ${problems.length} problem(s), repairing: ${problems.map((p) => p.what).slice(0, 4).join(" | ")}`);
    const repair = `Your report failed these quality checks. Return the FULL corrected report as the same JSON shape, changing only what is needed:\n${problems.map((p) => `- ${p.where}: ${p.what}`).join("\n")}`;
    try {
      const r2 = await runCodexTurn({ thread, prompt: repair, outputSchemaPath: path.join(here, "report-schema.json"), eventsPath: opts.eventsPath, timeoutMs: 5 * 60_000, idleTimeoutMs: 3 * 60_000 });
      const fixed = parse<DarkReport>(r2.finalResponse);
      if (checkDark(fixed, about).length <= problems.length) report = fixed;
    } catch (err) { console.warn("[quality] repair failed:", (err as Error).message); }
  }
  report = scrub(report);
  report.quality = checkDark(report, about).map((p) => `${p.where}: ${p.what}`);
  return report;
}

export async function gradeLight(about: SkoolAbout, ctx: { score: number; failed: Rule[]; verdicts: Verdict[] }, opts: { model: string; reasoning: string; eventsPath?: string }): Promise<LightReport> {
  const { version, rules } = await rubricText();
  const failedText = failedRulesText(ctx.failed, ctx.verdicts);
  const prompt = `You are Skool Roast doing a LIGHT roast: a quick, playful read of a Skool About page's copy for a Skool community owner. Voice: an experienced Skool coach roasting a page on a Loom, specific and funny, always with the fix. No em dashes.

${await voice()}

${STYLE}

${SCOPE}

The checklist pass is already done. The page scored ${ctx.score}/100. These are the rules it FAILED, with the auditor's reason; write 3 to 5 notes from these and only these, each citing that rule's source verbatim, plus one better sidebar headline that keeps their facts:
${failedText}

=== RUBRIC (${version}) ===
${rules}

=== ABOUT PAGE DATA ===
${renderAboutForModel(about)}`;
  const { thread } = await createCodexThread({ workingDirectory: root, model: opts.model, reasoning: "low", sandboxMode: "read-only", skipGitRepoCheck: true, isolated: true });
  const { finalResponse } = await runCodexTurn({ thread, prompt, outputSchemaPath: path.join(here, "light-schema.json"), eventsPath: opts.eventsPath, timeoutMs: 5 * 60_000, idleTimeoutMs: 3 * 60_000 });
  let report = parse<LightReport>(finalResponse);
  const problems = checkLight(report, about);
  if (problems.length) {
    console.log(`[quality] light: ${problems.length} problem(s), repairing`);
    const repair = `Your notes failed these quality checks. Return the FULL corrected JSON, changing only what is needed:\n${problems.map((p) => `- ${p.where}: ${p.what}`).join("\n")}`;
    try {
      const r2 = await runCodexTurn({ thread, prompt: repair, outputSchemaPath: path.join(here, "light-schema.json"), eventsPath: opts.eventsPath, timeoutMs: 4 * 60_000, idleTimeoutMs: 2 * 60_000 });
      const fixed = parse<LightReport>(r2.finalResponse);
      if (checkLight(fixed, about).length <= problems.length) report = fixed;
    } catch (err) { console.warn("[quality] repair failed:", (err as Error).message); }
  }
  report = scrub(report);
  report.quality = checkLight(report, about).map((p) => `${p.where}: ${p.what}`);
  return report;
}

/** Optional: ask Codex's built-in image generation for a cover concept. */
export async function generateCover(prompt: string, outPath: string, opts: { model: string; reasoning: string }): Promise<boolean> {
  const rel = path.relative(root, outPath);
  const { thread } = await createCodexThread({ workingDirectory: root, model: opts.model, reasoning: opts.reasoning, sandboxMode: "workspace-write", skipGitRepoCheck: true });
  const text = `Use the $imagegen skill and its built-in image generation mode to create one 16:9 Skool community cover image. Do not use an API key or the fallback CLI.

Primary request: ${prompt}
Constraints: one dominant idea, minimal or no words, no watermark, no fake UI, no neon AI imagery.

After generation, copy the final PNG from the built-in generated-images location to this exact workspace path:
${rel}

Finish only after the PNG exists at that exact path.`;
  try {
    await runCodexTurn({ thread, prompt: text, timeoutMs: 6 * 60_000, idleTimeoutMs: 3 * 60_000 });
    await readFile(outPath);
    return true;
  } catch (err) {
    console.warn("cover generation skipped:", (err as Error).message);
    return false;
  }
}
