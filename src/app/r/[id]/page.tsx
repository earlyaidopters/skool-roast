"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { use, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Logo } from "../../page";
import { scoreColor } from "@/lib/score";

const DARK_STAGES = ["Reading your About page", "Taking a screenshot", "Dark roast: grading the copy and visuals", "Redlining your page", "Building the ideal version"];
const DARK_VIDEO_STAGES = ["Reading your About page", "Taking a screenshot", "Watching your video", "Dark roast: grading the copy and visuals", "Redlining your page", "Building the ideal version"];
const LIGHT_STAGES = ["Reading your About page", "Light roast: reading the copy"];
function stageIndex(mode: "light" | "dark", status?: string, stage?: string, withVideo = false) {
  const v = withVideo ? 1 : 0; // the video step slots in after the screenshot
  if (status === "done") return mode === "light" ? LIGHT_STAGES.length : DARK_STAGES.length + v;
  const t = (stage ?? "").toLowerCase();
  if (mode === "light") return /checklist|writing|notes/.test(t) ? 1 : 0;
  if (/ideal/.test(t)) return 4 + v;
  if (/redlin/.test(t) || status === "rendering") return 3 + v;
  if (/checklist|writing|grading/.test(t) || status === "grading") return 2 + v;
  if (/video/.test(t)) return 2;
  if (/screenshot/.test(t)) return 1;
  return 0; // queued or reading: step 1 is live from the first second
}
const SEV: Record<string, string> = { high: "var(--sk-red)", medium: "var(--sk-yellow)", low: "var(--sk-sky)" };

type Source = { video_title: string; video_url: string; timestamp: string; speaker: string };
type Issue = { target: string; quote: string; slot?: number; severity: string; title: string; roast: string; detail: string; fix: string; source: Source };
type MediaSlot = { slot: number; current: string; action: "keep" | "replace" | "remove" | "add"; should_show: string };
type DarkReport = { score: number; verdict: string; summary: string; issues: Issue[]; located?: boolean[]; ideal: { sidebar_headline: string; about_body: string; cover_direction: string; media_plan: MediaSlot[] } };
type LightReport = { score: number; verdict: string; summary: string; notes: Array<{ title: string; roast: string; fix: string; source: Source }>; rewritten_headline: string };
const TARGET_LABEL: Record<string, string> = { cover: "cover", name: "name", sidebar_headline: "sidebar headline", body: "about copy", media: "main video", attachment: "attachment", general: "overall" };
const MODE = {
  light: { color: "var(--sk-sky)", name: "Light roast", tag: "a gentle sip", blurb: "Quick read of the copy, text only. The score skips cover and video rules, so the dark roast can land lower." },
  dark: { color: "var(--sk-red)", name: "Dark roast", tag: "the full burn", blurb: "Redlined line by line, every slot judged, ideal version built." },
} as const;
const ACTION_COLOR: Record<string, string> = { keep: "var(--sk-sky)", replace: "var(--sk-yellow)", remove: "var(--sk-red)", add: "var(--sk-blue)" };

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const audit = useQuery(api.audits.status, { id: id as Id<"audits"> });
  const payload = useQuery(api.audits.report, audit && audit.status === "done" ? { id: id as Id<"audits"> } : "skip");
  const queue = useQuery(api.audits.queuePosition, { id: id as Id<"audits"> });
  const eta = useQuery(api.audits.eta, { id: id as Id<"audits"> });

  if (audit === undefined) return <Shell><div className="skeleton mt-10 h-40 rounded-2xl" /></Shell>;
  if (audit === null) return <Shell><p className="mt-10">No roast found for this link.</p></Shell>;

  const mode = (audit.roast ?? "dark") as "light" | "dark";
  const withVideo = Boolean(audit.analyzeVideo);
  const stages = mode === "light" ? LIGHT_STAGES : withVideo ? DARK_VIDEO_STAGES : DARK_STAGES;
  const dark = mode === "dark" ? (payload?.report as DarkReport | undefined) : undefined;
  const light = mode === "light" ? (payload?.report as LightReport | undefined) : undefined;
  const report = dark ?? light;
  const working = audit.status !== "done" && audit.status !== "failed";
  const idx = stageIndex(mode, audit.status, audit.stage, withVideo);

  return (
    <Shell share={report ? { id, slug: audit.slug } : undefined}>
      <div className="reveal d1 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-[var(--muted)]">Roast report</p>
          <h1 className="display mt-1 break-all text-3xl font-extrabold sm:text-5xl">skool.com/{audit.slug}</h1>
        </div>
        {report && <ScoreRing score={report.score ?? 0} />}
      </div>

      <div className="reveal d2 mt-6 flex items-start gap-4 rounded-2xl border-3 border-[var(--ink)] bg-[var(--cream)] p-4 sm:items-center" style={{ boxShadow: `var(--shadow-off) var(--shadow-off) 0 ${MODE[mode].color}` }}>
        <img src={`/img/${mode}-roast.png`} alt="" className="bob h-14 w-14 shrink-0 sm:h-20 sm:w-20" />
        <div className="min-w-0">
          <span className="sticker display text-sm" style={{ background: MODE[mode].color, color: mode === "dark" ? "#fff" : "var(--ink)" }}>{MODE[mode].name} · {MODE[mode].tag}</span>
          <p className="mt-2 text-[15px] text-[#3a3a44]">{MODE[mode].blurb}</p>
        </div>
      </div>

      {working && <Stepper idx={idx} stages={stages} mode={mode} queue={audit.status === "queued" ? queue : undefined} stage={audit.stage} eta={eta ?? undefined} />}

      {audit.status === "failed" && (
        <div className="card mt-10 rounded-2xl p-6" style={{ ["--shadow" as string]: "var(--sk-red)" }}>
          <p className="display text-xl font-extrabold">That one didn't cook.</p>
          <p className="mt-1 text-[#3a3a40]">{audit.error}</p>
          <Link href="/" className="mt-3 inline-block font-semibold underline">Try another link</Link>
        </div>
      )}

      {report && (
        <>
          {(audit.verdictsFrom || typeof audit.previousScore === "number") && (
            <p className="reveal d2 mt-6 inline-flex items-center gap-2 rounded-full border-2 border-[var(--ink)] bg-[var(--cream)] px-4 py-1.5 text-sm font-semibold">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: audit.pageChanged ? "var(--sk-red)" : "var(--sk-sky)" }} />
              {audit.pageChanged
                ? `Page changed since your last roast${typeof audit.previousScore === "number" ? ` (was ${audit.previousScore})` : ""}. Fresh checklist.`
                : audit.verdictsFrom === "cache"
                  ? "Page unchanged since your last roast. Same checklist, same score."
                  : typeof audit.previousScore === "number" ? `Fresh checklist. Last time: ${audit.previousScore}.` : "Fresh checklist."}
            </p>
          )}
          <div className="card reveal d2 mt-8 rounded-2xl p-6" style={{ ["--shadow" as string]: MODE[mode].color }}>
            <p className="display text-2xl font-bold leading-snug sm:text-3xl">{report.verdict}</p>
            <p className="mt-4 text-lg leading-relaxed text-[#3a3a44]">{report.summary}</p>
          </div>

          {light && (
            <>
              <Section title="The notes" accent="var(--sk-sky)">
                <ol className="grid gap-4">
                  {light.notes.map((n, i) => (
                    <li key={i} className="card rounded-2xl p-5" style={{ ["--shadow" as string]: "var(--sk-sky)" }}>
                      <div className="flex items-center gap-3">
                        <span className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sk-sky)] text-base font-extrabold text-white">{i + 1}</span>
                        <span className="display text-xl font-extrabold leading-tight">{n.title}</span>
                      </div>
                      <p className="mt-3 text-[15px] italic leading-relaxed text-[#2a2a30]">{n.roast}</p>
                      <p className="mt-2 text-[15px] leading-relaxed"><span className="font-semibold">Fix.</span> {n.fix}</p>
                      <SourceLink s={n.source} />
                    </li>
                  ))}
                </ol>
              </Section>
              <Section title="A better sidebar headline" accent="var(--sk-yellow)">
                <div className="card rounded-2xl p-6" style={{ ["--shadow" as string]: "var(--sk-yellow)" }}>
                  <p className="display text-xl font-bold leading-snug">{light.rewritten_headline}</p>
                </div>
              </Section>
              <div className="card mt-10 flex items-center gap-4 rounded-2xl p-5" style={{ ["--shadow" as string]: "var(--sk-red)" }}>
                <img src="/img/dark-roast.png" alt="" className="h-16 w-16" />
                <div>
                  <p className="display text-lg font-extrabold">Want it redlined?</p>
                  <p className="text-[15px] text-[#3a3a44]">The dark roast marks up your actual page line by line and builds the ideal version. <Link href="/" className="font-semibold underline">Run one</Link>.</p>
                </div>
              </div>
            </>
          )}

          {dark && (
            <>
              {audit.annotatedUrl && (
                <Section title="Your page, redlined" accent="var(--sk-red)">
                  <p className="mb-3 text-sm text-[var(--muted)]">Numbers match the notes below. Highlights sit on the exact copy, cover, or video each note is about.</p>
                  <div className="card overflow-hidden rounded-2xl p-2" style={{ ["--shadow" as string]: "var(--sk-red)" }}>
                    <img src={audit.annotatedUrl} alt="Your About page with numbered redlines" className="w-full rounded-xl" />
                  </div>
                </Section>
              )}

              {withVideo && <VideoCard video={(payload?.video as VideoData | null | undefined) ?? null} />}

              <Section title="The notes, in order" accent="var(--sk-yellow)">
                <ol className="grid gap-4">
                  {dark.issues.map((iss, i) => (
                    <li key={i} className="card min-w-0 rounded-2xl p-4 sm:p-5" style={{ ["--shadow" as string]: SEV[iss.severity] }}>
                      <div className="flex items-center gap-3">
                        <span className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-white" style={{ background: SEV[iss.severity] }}>{i + 1}</span>
                        <span className="display min-w-0 break-words text-lg font-extrabold leading-tight sm:text-xl">{iss.title}</span>
                        <span className="sev ml-auto hidden sm:inline" style={{ color: SEV[iss.severity] }}>{iss.target === "attachment" && iss.slot ? `slot ${iss.slot}` : (TARGET_LABEL[iss.target] ?? iss.target)}</span>
                      </div>
                      {iss.quote && <p className="mt-3 break-words border-l-4 pl-3 text-[14px] text-[#5a5a60]" style={{ borderColor: SEV[iss.severity] }}>“{iss.quote}”</p>}
                      <p className="mt-3 text-[15px] italic leading-relaxed text-[#2a2a30]">{iss.roast}</p>
                      <p className="mt-2 text-[15px] leading-relaxed text-[#2a2a30]">{iss.detail}</p>
                      <p className="mt-2 text-[15px] leading-relaxed"><span className="font-semibold">Fix.</span> {iss.fix}</p>
                      <SourceLink s={iss.source} />
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Your six slots" accent="var(--sk-blue)">
                <p className="mb-3 text-sm text-[var(--muted)]">Slot 1 is the main video. Slots 2 to 6 are the thumbnails under it, left to right. Each one has to earn its place.</p>
                <ol className="grid gap-3 sm:grid-cols-2">
                  {[...(dark.ideal?.media_plan ?? [])].sort((a, b) => a.slot - b.slot).map((m) => (
                    <li key={m.slot} className="card min-w-0 rounded-2xl p-4" style={{ ["--shadow" as string]: ACTION_COLOR[m.action] }}>
                      <div className="flex items-center gap-3">
                        <span className="display flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-white text-sm font-extrabold">{m.slot}</span>
                        <span className="sev shrink-0" style={{ color: ACTION_COLOR[m.action] }}>{m.action}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 break-words text-xs text-[#8a857b]" title={m.current}>{m.current === "empty" ? "Empty right now." : "Now: " + m.current.replace(/^https?:\/\/[^\s]+$/, "media")}</p>
                      <p className="mt-2 break-words text-[15px] leading-snug">{m.should_show}</p>
                    </li>
                  ))}
                </ol>
              </Section>

              {audit.idealUrl && (
                <Section title="The ideal version" accent="var(--sk-sky)">
                  <div className="card overflow-hidden rounded-2xl p-2" style={{ ["--shadow" as string]: "var(--sk-sky)" }}>
                    <img src={audit.idealUrl} alt="Ideal About page mock" className="w-full rounded-xl" />
                  </div>
                </Section>
              )}

              {dark.ideal?.about_body && (
                <Section title="Paste this into Skool" accent="var(--sk-blue)">
                  <CopyBlock ideal={dark.ideal} />
                </Section>
              )}

              {audit.coverIdeaUrl && (
                <Section title="Cover concept" accent="var(--sk-yellow)">
                  <img src={audit.coverIdeaUrl} alt="Cover concept" className="w-full max-w-xl rounded-2xl border-2 border-[var(--ink)]" />
                </Section>
              )}

              {audit.screenshotUrl && (
                <details className="mt-12 text-[var(--muted)]">
                  <summary className="cursor-pointer text-sm hover:text-[var(--ink)]">Original screenshot</summary>
                  <img src={audit.screenshotUrl} alt="Original About page" className="mt-3 w-full rounded-xl border-2 border-[var(--ink)]" />
                </details>
              )}
            </>
          )}
        </>
      )}

      {payload?.verdicts && (
        <details className="mt-12">
          <summary className="display cursor-pointer text-lg font-extrabold">The checklist behind the score</summary>
          <p className="mt-2 text-sm text-[var(--muted)]">Score = passed weight ÷ judged weight, computed from these verdicts. The roast text can vary; this list decides the number.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {(payload?.verdicts as Array<{ id: string; verdict: string; reason: string }>).map((v) => (
              <li key={v.id} className="flex items-start gap-3 rounded-xl border-2 border-[var(--ink)] bg-white px-3 py-2 text-sm">
                <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: v.verdict === "pass" ? "var(--sk-sky)" : v.verdict === "fail" ? "var(--sk-red)" : "#d6d6de" }} />
                <span><span className="font-bold">{v.id}</span> · {v.verdict} · <span className="text-[#5a5a60]">{v.reason}</span></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="mt-20 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
        <Link href="/" className="font-semibold text-[var(--ink)] underline">Roast another</Link>
        <span>Advice is the Skool team's and Hormozi's. The grading is a model's, so use judgment.</span>
      </footer>
    </Shell>
  );
}

function ShareMenu({ id, slug }: { id: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cardPath = `/r/${id}/card`;
  function flash(t: string) { setNote(t); setTimeout(() => { setNote(null); setOpen(false); }, 1500); }
  async function copyImage() {
    try {
      const png = fetch(cardPath).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      flash("Image copied");
    } catch { flash("Use Download"); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/r/${id}`); flash("Link copied"); } catch { flash("Could not copy"); }
  }
  const item = "block w-full px-4 py-2 text-left text-sm font-semibold hover:bg-[var(--cream)]";
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Share this roast" title="Share this roast" className="copy-btn flex h-10 w-10 items-center justify-center rounded-full">
        <ShareIcon />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border-2 border-[var(--ink)] bg-white py-1" style={{ boxShadow: "4px 4px 0 var(--sk-blue)" }}>
          {note ? <p className="px-4 py-2 text-sm font-semibold">{note}</p> : (
            <>
              <button onClick={copyImage} className={item}>Copy image</button>
              <a href={cardPath} download={`skool-roast-${slug}.png`} className={item} onClick={() => flash("Downloading")}>Download image</a>
              <button onClick={copyLink} className={item}>Copy link</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function ShareIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>;
}

function Stepper({ idx, stages, mode, queue, stage, eta }: { idx: number; stages: string[]; mode: "light" | "dark"; queue?: { ahead: number; running: number } | null; stage?: string; eta?: { seconds: number; cooldownSeconds: number } }) {
  const busy = (stage ?? "").startsWith("Codex is busy") || (eta?.cooldownSeconds ?? 0) > 0;
  const etaText = eta ? (eta.seconds < 90 ? `about ${Math.max(15, Math.round(eta.seconds / 15) * 15)} seconds` : `about ${Math.ceil(eta.seconds / 60)} minutes`) : null;
  const fill = Math.max(0, Math.min(100, (idx / (stages.length - 1)) * 100));
  return (
    <div className="card-dark reveal d2 mt-8 rounded-2xl p-5 sm:mt-10 sm:p-8">
      <div className="flex items-center gap-3">
        <img src={`/img/${mode}-roast.png`} alt="" className="flame h-12 w-12" />
        <div>
          <p className="display text-lg font-bold">{mode === "light" ? "Brewing a light roast." : "Cooking a dark roast."} {etaText ? `Ready in ${etaText}.` : mode === "light" ? "About a minute." : "Three to four minutes."} This page updates itself.</p>
          {busy && <p className="mt-1 text-sm text-[#8a857b]">Codex is at capacity for a moment. Your roast is holding its place in line and will resume on its own.</p>}
        </div>
      </div>
      {queue && (queue.ahead > 0 || queue.running > 0) && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {queue.ahead === 0 ? "You're next." : `${queue.ahead} roast${queue.ahead === 1 ? "" : "s"} ahead of you.`} {queue.running > 0 ? `${queue.running} cooking right now.` : ""}
        </p>
      )}
      <ol className="relative mt-7 grid gap-5">
        <div className="step-line absolute left-[15px] top-4 bottom-4 w-[2px]" style={{ ["--fill" as string]: `${fill}%` }} />
        {stages.map((label, i) => {
          const state = i < idx ? "done" : i === idx ? "active" : "todo";
          return (
            <li key={label} className="relative flex items-center gap-4 pl-11">
              <span
                className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold"
                style={{
                  borderColor: state === "todo" ? "#d6d6de" : "var(--ink)",
                  background: state === "done" ? "var(--sk-red)" : state === "active" ? "var(--sk-yellow)" : "var(--paper)",
                  color: state === "done" ? "#fff" : "var(--ink)",
                }}
              >
                {state === "done" ? <CheckIcon /> : state === "active" ? <span className="flicker h-2.5 w-2.5 rounded-full bg-[var(--sk-red)]" /> : i + 1}
              </span>
              <span className={state === "todo" ? "text-[var(--muted)]" : state === "active" ? "display font-bold" : ""}>
                {label}
                {state === "active" && queue && <span className="ml-2 text-sm font-normal text-[var(--muted)]">{queue.ahead > 0 ? `in line, ${queue.ahead} ahead` : queue.running > 0 ? "next up" : "starting"}</span>}
                {state === "active" && !queue && stage && stage.toLowerCase() !== label.toLowerCase() && <span className="ml-2 text-sm font-normal text-[var(--muted)]">{stage.replace(/^(Dark|Light) roast: /, "")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type VideoObs = { hook_transcript: string; opens_with_promise: boolean; format: string; shows_result_or_inside: boolean; has_direct_cta: boolean; captions_present: boolean; captions_readable_on_phone: boolean; production_quality: string; structure_seen: string[]; summary: string };
type VideoData = { status: "analyzed"; url: string; lengthMs?: number; analyzedSeconds: number; from: string; observations: VideoObs } | { status: "skipped"; url?: string; reason: string };
function VideoCard({ video }: { video: VideoData | null }) {
  if (!video) return null;
  if (video.status === "skipped") {
    return (
      <Section title="Your video" accent="var(--sk-sky)">
        <div className="card rounded-2xl p-4 sm:p-5" style={{ ["--shadow" as string]: "var(--sk-sky)" }}>
          <p className="display text-lg font-extrabold">We couldn't watch it this time.</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#3a3a44]">{video.reason}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">The rest of the roast, including the video slot, was graded from the page and thumbnail. Nothing was charged for the video.</p>
        </div>
      </Section>
    );
  }
  const o = video.observations;
  const checks: Array<[string, boolean]> = [
    ["Opens with the outcome", o.opens_with_promise],
    ["Shows the real thing, not just a face", o.shows_result_or_inside],
    ["Ends with a direct ask to join", o.has_direct_cta],
    ["Captions you can read on a phone", o.captions_present && o.captions_readable_on_phone],
  ];
  const beats = ["promise", "pain", "proof", "whats_inside", "objections", "urgency", "cta"];
  return (
    <Section title="Your video" accent="var(--sk-sky)">
      <p className="mb-3 text-sm text-[var(--muted)]">A model watched the first {video.analyzedSeconds} seconds{video.lengthMs ? ` of ${Math.round(video.lengthMs / 1000)}` : ""}. {o.format.replace("_", " ")}, {o.production_quality} production.</p>
      <div className="card rounded-2xl p-4 sm:p-5" style={{ ["--shadow" as string]: "var(--sk-sky)" }}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checks.map(([label, ok]) => (
            <li key={label} className="flex items-center gap-2 text-[15px]"><span className="display flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ink)] text-xs font-extrabold" style={{ background: ok ? "var(--sk-yellow)" : "var(--sk-red)", color: ok ? "var(--ink)" : "#fff" }}>{ok ? "✓" : "✗"}</span>{label}</li>
          ))}
        </ul>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[.2em] text-[#8a857b]">Beats we heard</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {beats.map((b) => <span key={b} className="sev" style={{ color: o.structure_seen.includes(b) ? "var(--ink)" : "#b8b4aa", borderColor: "currentColor" }}>{b.replace("_", " ")}</span>)}
        </div>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[.2em] text-[#8a857b]">First 15 seconds</p>
        <p className="mt-1 break-words border-l-4 border-[var(--sk-sky)] pl-3 text-[14px] text-[#5a5a60]">“{o.hook_transcript}”</p>
        <p className="mt-4 text-[15px] leading-relaxed">{o.summary}</p>
      </div>
    </Section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const c = scoreColor(score);
  return (
    <div className="reveal d2 flex flex-col items-center gap-2">
      <div className="relative flex h-32 w-32 items-center justify-center rounded-full ring" style={{ ["--p" as string]: score, ["--ring-color" as string]: c.bg }}>
        <div className="relative text-center">
          <div className="display text-5xl font-extrabold leading-none" style={{ color: c.bg === "#eab04b" || c.bg === "#4db5f2" ? "var(--ink)" : c.bg }}>{score}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted)]">of 100</div>
        </div>
      </div>
      <span className="display rounded-full border-2 border-[var(--ink)] px-3 py-0.5 text-xs font-extrabold uppercase tracking-wider" style={{ background: c.bg, color: c.fg }}>{c.label}</span>
    </div>
  );
}

function CopyBlock({ ideal }: { ideal: DarkReport["ideal"] }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1600); } catch {}
  }
  const Label = ({ children }: { children: React.ReactNode }) => <p className="mt-6 text-[10px] font-bold uppercase tracking-[.2em] text-[#8a857b] first:mt-0">{children}</p>;
  return (
    <div className="card rounded-2xl p-4 sm:p-6" style={{ ["--shadow" as string]: "var(--sk-blue)" }}>
      <div className="flex items-start justify-between gap-4">
        <div><Label>Sidebar headline</Label><p className="display mt-1 text-xl font-bold leading-snug">{ideal.sidebar_headline}</p></div>
        <button onClick={() => copy("h", ideal.sidebar_headline)} className="copy-btn shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition">{copied === "h" ? "Copied" : "Copy"}</button>
      </div>
      <div className="flex items-start justify-between gap-4">
        <Label>About body (unicode bold survives the paste)</Label>
        <button onClick={() => copy("b", ideal.about_body)} className="copy-btn mt-5 shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition">{copied === "b" ? "Copied" : "Copy"}</button>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-[inherit] text-[15px] leading-relaxed">{ideal.about_body}</pre>
      <Label>Cover direction</Label><p className="mt-1 text-[15px]">{ideal.cover_direction}</p>
      <Label>Attachments, in order</Label>
      <ol className="mt-1 space-y-1 pl-0 text-[15px]">{[...(ideal.media_plan ?? [])].sort((a, b) => a.slot - b.slot).map((m) => <li key={m.slot}><span className="font-bold">Slot {m.slot}</span> · {m.action} · {m.should_show}</li>)}</ol>
    </div>
  );
}
function sourceSuffix(ts: string) {
  if (/^\d+:\d+$/.test(ts)) return ` at ${ts}`;
  if (ts === "roast") return ", Loom roast";
  if (ts === "post") return ", Skool post";
  if (ts === "lesson") return ", Platinum classroom";
  if (ts === "doc") return ", Skool template";
  return "";
}
function SourceLink({ s }: { s: Source }) {
  const label = `${s.speaker}, ${s.video_title}${sourceSuffix(s.timestamp)}`;
  if (!/^https?:\/\//.test(s.video_url)) return <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#5a5a60]"><PlayIcon />{label}</p>;
  return (
    <a href={clipUrl(s.video_url, s.timestamp)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--sk-blue)] hover:underline">
      <PlayIcon />{label}
    </a>
  );
}
function clipUrl(url: string, ts: string) {
  const m = ts.match(/^(\d+):(\d+)$/);
  if (!m || !/youtube\.com|youtu\.be/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${Number(m[1]) * 60 + Number(m[2])}s`;
}
function Shell({ children, share }: { children: React.ReactNode; share?: { id: string; slug: string } }) {
  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8 sm:px-6 sm:pt-10">
      <header className="mb-10 flex items-center justify-between"><Logo />{share && <ShareMenu id={share.id} slug={share.slug} />}</header>
      {children}
    </main>
  );
}
function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="display mb-4 flex items-center gap-3 text-xl font-extrabold sm:mb-5 sm:text-2xl"><span className="inline-block h-6 w-1.5 rounded-full" style={{ background: accent }} />{title}</h2>
      {children}
    </section>
  );
}
function CheckIcon({ color }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="mt-[5px] shrink-0"><path d="M20 6 9 17l-5-5" /></svg>;
}
function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function FlameIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="flame">
      <path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1-3s.5 2 2 2c0-3 1-5 2-9Z" fill="var(--sk-red)" />
      <path d="M12 10c.5 2 2.5 2.5 2.5 5a2.5 2.5 0 0 1-5 0c0-1.5 1-2 1-2s.2 1 1 1c0-1.5.2-2.5.5-4Z" fill="var(--sk-yellow)" />
    </svg>
  );
}
