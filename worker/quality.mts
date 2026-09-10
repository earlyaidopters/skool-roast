/**
 * Quality gate for generated roasts. Deterministic checks the model must pass;
 * failures are fed back for one repair pass, then the best available version ships.
 */
import type { DarkReport, LightReport } from "./grade.mts";
import type { SkoolAbout } from "../src/lib/skool.ts";

const BANNED_PHRASES = [
  "no fluff, just results", "remove the guesswork", "stop overthinking", "you need to know what actually works",
  "unlock your potential", "take it to the next level", "game-changer", "game changer", "level up", "transform your",
  "in today's", "look no further", "supercharge", "unleash", "elevate your", "seamless", "cutting-edge", "robust",
  "dive in", "delve", "leverage", "empower", "journey", "ecosystem", "synergy", "holistic",
];
const GENERIC_NOTE_PHRASES = [
  "consider adding", "you may want to", "it would be beneficial", "could be improved", "make it more engaging",
  "add more value", "be more specific", "optimize", "enhance", "compelling", "resonate",
];

export type Problem = { where: string; what: string };

function hasEmDash(s: string) { return /[—–]/.test(s); }
function norm(s: string) { return s.replace(/\s+/g, " ").trim().toLowerCase(); }

export function checkDark(r: DarkReport, about: SkoolAbout): Problem[] {
  const p: Problem[] = [];
  const all = [r.verdict, r.summary, ...r.issues.flatMap((i) => [i.title, i.roast, i.detail, i.fix]), r.ideal.sidebar_headline, r.ideal.about_body, r.ideal.cover_direction, ...r.ideal.media_plan.map((m) => m.should_show)];
  if (all.some(hasEmDash)) p.push({ where: "anywhere", what: "em dash or en dash present; use a comma, period, or colon" });
  for (const b of BANNED_PHRASES) if (norm(r.ideal.about_body).includes(b) || norm(r.ideal.sidebar_headline).includes(b)) p.push({ where: "ideal", what: `banned empty phrase in the rewrite: "${b}"` });
  if (r.ideal.sidebar_headline.length > 150) p.push({ where: "ideal.sidebar_headline", what: `${r.ideal.sidebar_headline.length} characters; Skool caps the group description at 150` });
  if (r.ideal.about_body.length > 1000) p.push({ where: "ideal.about_body", what: `${r.ideal.about_body.length} characters; Skool caps the About body at 1,000` });
  if (/https?:\/\//i.test(r.ideal.about_body)) p.push({ where: "ideal.about_body", what: "contains an external link; the About body must not link out" });
  if (/[\u{1F525}\u{1F451}\u{1F48E}\u{1F340}]/u.test(r.ideal.about_body)) p.push({ where: "ideal.about_body", what: "uses a fire, crown, gem, or shamrock emoji; on Skool those mean streaks and levels" });
  const body = norm(about.body);
  r.issues.forEach((i, n) => {
    if (i.target === "body") {
      if (!i.quote.trim()) p.push({ where: `issues[${n}]`, what: "target=body but quote is empty; copy the exact line from the About body" });
      else if (!body.includes(norm(i.quote))) p.push({ where: `issues[${n}]`, what: `quote is not verbatim from the About body: "${i.quote.slice(0, 60)}"` });
      if (!/["“]|:/.test(i.fix) && i.fix.split(" ").length < 8) p.push({ where: `issues[${n}].fix`, what: "body fixes must give the replacement line, not a direction" });
    }
    if (i.target === "attachment" && !(i.slot && i.slot >= 1 && i.slot <= 6)) p.push({ where: `issues[${n}]`, what: "target=attachment needs slot 1 to 6" });
    for (const g of GENERIC_NOTE_PHRASES) if (norm(i.detail + " " + i.fix).includes(g)) p.push({ where: `issues[${n}]`, what: `generic phrasing "${g}"; say the concrete change instead` });
    if (i.roast.split(" ").length > 22) p.push({ where: `issues[${n}].roast`, what: "roast line over 22 words" });
  });
  const titles = r.issues.map((i) => norm(i.title));
  if (new Set(titles).size !== titles.length) p.push({ where: "issues", what: "duplicate note titles" });
  const slots = r.ideal.media_plan.map((m) => m.slot).sort();
  if (new Set(slots).size !== slots.length) p.push({ where: "ideal.media_plan", what: "duplicate slot numbers" });
  if (about.ownerFirstName && !(r.verdict + r.summary).includes(about.ownerFirstName)) p.push({ where: "summary", what: `address the creator by first name (${about.ownerFirstName}) at least once in verdict or summary` });
  return p;
}

export function checkLight(r: LightReport, about: SkoolAbout): Problem[] {
  const p: Problem[] = [];
  const all = [r.verdict, r.summary, r.rewritten_headline, ...r.notes.flatMap((n) => [n.title, n.roast, n.fix])];
  if (all.some(hasEmDash)) p.push({ where: "anywhere", what: "em dash or en dash present; use a comma, period, or colon" });
  if (r.rewritten_headline.length > 150) p.push({ where: "rewritten_headline", what: `${r.rewritten_headline.length} characters; cap is 150` });
  for (const b of BANNED_PHRASES) if (norm(r.rewritten_headline).includes(b)) p.push({ where: "rewritten_headline", what: `banned empty phrase: "${b}"` });
  r.notes.forEach((n, i) => {
    for (const g of GENERIC_NOTE_PHRASES) if (norm(n.fix).includes(g)) p.push({ where: `notes[${i}]`, what: `generic phrasing "${g}"; say the concrete change instead` });
    if (n.roast.split(" ").length > 22) p.push({ where: `notes[${i}].roast`, what: "roast line over 22 words" });
  });
  if (about.ownerFirstName && !(r.verdict + r.summary).includes(about.ownerFirstName)) p.push({ where: "summary", what: `address the creator by first name (${about.ownerFirstName}) at least once` });
  return p;
}

/** Last-resort scrub for things we can fix in code without changing meaning. */
export function scrub<T>(obj: T): T {
  const fix = (s: string) => s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
  const walk = (v: unknown): unknown => (typeof v === "string" ? fix(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)])) : v);
  return walk(obj) as T;
}
