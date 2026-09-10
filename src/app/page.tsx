"use client";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import { normalizeSkoolUrl } from "@/lib/skool";
import { scoreColor } from "@/lib/score";

type Roast = "light" | "dark";
const RULES = [
  "Sell the outcome, not the topic",
  "Say who it's for in one line",
  "Show the result, not a talking head",
  "Six attachments, use them",
  "Cover that says the promise",
  "First line is the headline",
  "Your voice, not a brochure",
  "Value per second, not seconds of value",
];

export default function Home() {
  const router = useRouter();
  const create = useMutation(api.audits.create);
  const { results: recent, status: recentStatus, loadMore } = usePaginatedQuery(api.audits.recentPage, {}, { initialNumItems: 20 });
  const [value, setValue] = useState("");
  const [roast, setRoast] = useState<Roast>("dark");
  const [video, setVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { slug, url } = normalizeSkoolUrl(value);
      setBusy(true);
      const id = await create({ slug, inputUrl: url, roast, analyzeVideo: roast === "dark" && video });
      router.push(`/r/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 sm:pt-14">
      <header className="reveal d1 flex items-center justify-between">
        <Logo />
      </header>

      <section className="mt-14 sm:mt-20">
        <h1 className="display reveal d2 text-[15vw] leading-[.88] sm:text-[8rem]">
          Roast my
          <br />
          <span className="bob text-[var(--sk-blue)]">s</span>
          <span className="bob text-[var(--sk-red)]">k</span>
          <span className="bob text-[var(--sk-yellow)]">o</span>
          <span className="bob text-[var(--sk-sky)]">o</span>
          <span className="bob text-[var(--sk-red)]">l</span>
          <span className="bob text-[var(--ink)]">.</span>
        </h1>
        <p className="reveal d3 mt-8 max-w-xl text-lg leading-relaxed text-[#3a3a44] sm:text-xl">
          Paste your Skool link. Your About page copy, cover, and videos get roasted against what Hormozi and the
          Skool team actually say, with the clip for every note and the rewrite you can paste in.
        </p>

        <form onSubmit={onSubmit} className="reveal d4 mt-10 max-w-3xl">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="skool.com/your-community" className="field flex-1 rounded-2xl px-5 py-4 text-lg" autoFocus />
            <button disabled={busy || !value.trim()} className="btn display rounded-2xl px-7 py-4 text-lg font-extrabold">
              {busy ? "Lighting it up..." : roast === "light" ? "Light roast it" : "Dark roast it"}
            </button>
          </div>
          {error && <p className="mt-3 font-semibold text-[var(--sk-red)]">{error}</p>}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <RoastPick
              active={roast === "light"} onPick={() => setRoast("light")} img="/img/light-roast.png" title="Light roast" time="about a minute" shadow="var(--sk-sky)"
              blurb="A quick read of your copy. Score, a few playful notes, one better headline. No pictures."
            />
            <RoastPick
              active={roast === "dark"} onPick={() => setRoast("dark")} img="/img/dark-roast.png" title="Dark roast" time="three to four minutes" shadow="var(--sk-red)"
              blurb="The full thing. Your page redlined line by line, the clip behind every note, and an ideal version to paste in."
            />
          </div>
          {roast === "dark" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-dashed border-[var(--ink)]/30 px-4 py-3 text-[15px] transition hover:border-[var(--ink)]">
              <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--sk-red)]" />
              <span>
                <span className="font-bold">Also roast my video.</span> A model watches the first three minutes of your main video and grades the hook, format, and ask.{" "}
                <span className="text-[var(--muted)]">Adds about a minute. Loom and YouTube work best; if we can't watch it, you still get the full roast.</span>
              </span>
            </label>
          )}
        </form>
        <p className="reveal d5 mt-4 text-sm text-[var(--muted)]">Public or private communities. No login. Only the parts you can actually edit get graded.</p>
      </section>

      <section className="reveal d5 mt-16 overflow-hidden rounded-full border-3 border-[var(--ink)] bg-[var(--cream)] py-3">
        <div className="marquee display text-sm font-bold uppercase tracking-[.15em] text-[var(--ink)]">
          {[...RULES, ...RULES].map((r, i) => (
            <span key={i} className="flex items-center gap-12"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sk-red)]" />{r}</span>
          ))}
        </div>
      </section>

      {recent && recent.length > 0 && (
        <section className="mt-16">
          <h2 className="display text-xs font-bold uppercase tracking-[.2em] text-[var(--muted)]">Fresh off the grill</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {recent.map((r) => (
              <li key={r._id}>
                <Link href={`/r/${r._id}`} className="card-dark flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition hover:-translate-y-0.5">
                  <span className="flex items-center gap-3 font-medium">
                    <img src={`/img/${r.roast}-roast.png`} alt="" className="h-8 w-8" />
                    <span>skool.com/{r.slug}</span>
                    <span className="sev hidden sm:inline" style={{ color: r.roast === "light" ? "var(--sk-sky)" : "var(--sk-red)", borderColor: "currentColor" }}>{r.roast}</span>
                  </span>
                  <span className="display rounded-full border-2 border-[var(--ink)] px-3 py-1 text-sm font-extrabold" style={{ background: scoreColor(r.score).bg, color: scoreColor(r.score).fg }}>{r.score ?? "–"}</span>
                </Link>
              </li>
            ))}
          </ul>
          {recentStatus === "CanLoadMore" && (
            <button type="button" onClick={() => loadMore(20)} className="card mt-6 rounded-xl px-5 py-2.5 text-sm font-bold uppercase tracking-wider transition hover:-translate-y-0.5" style={{ ["--shadow" as string]: "var(--sk-blue)" }}>Show more roasts</button>
          )}
          {recentStatus === "LoadingMore" && <p className="mt-6 text-sm text-[var(--muted)]">Loading more…</p>}
        </section>
      )}

      <footer className="mt-24 text-sm text-[var(--muted)]">Built by the Early AI-dopters community. Advice is the Skool team's and Hormozi's; the grading is a model's, so use judgment.</footer>
    </main>
  );
}

function RoastPick({ active, onPick, img, title, time, blurb, shadow }: { active: boolean; onPick: () => void; img: string; title: string; time: string; blurb: string; shadow: string }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={active} className={`card flex items-center gap-4 rounded-2xl p-4 text-left transition ${active ? "-translate-y-1" : "opacity-70 hover:opacity-100"}`} style={{ ["--shadow" as string]: active ? shadow : "#d9d9e0" }}>
      <img src={img} alt="" className={`h-24 w-24 shrink-0 ${active ? "bob" : ""}`} />
      <span>
        <span className="display block text-xl font-extrabold">{title} <span className="text-sm font-semibold text-[var(--muted)]">· {time}</span></span>
        <span className="mt-1 block text-[14px] leading-snug text-[#3a3a44]">{blurb}</span>
      </span>
    </button>
  );
}

export function Logo() {
  return (
    <Link href="/" className="display text-2xl font-extrabold tracking-tight">
      <span className="text-[var(--sk-blue)]">s</span><span className="text-[var(--sk-red)]">k</span><span className="text-[var(--sk-yellow)]">o</span><span className="text-[var(--sk-sky)]">o</span><span className="text-[var(--sk-red)]">l</span>
      <span className="ml-1 text-[var(--ink)]">roast</span>
    </Link>
  );
}
