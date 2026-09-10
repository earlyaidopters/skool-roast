"""Convert YouTube auto-caption VTT files into clean, timestamped transcript markdown.

Auto captions repeat each line across overlapping cues; we dedupe by keeping the
last distinct line per cue and merging into ~30s paragraphs with a [mm:ss] stamp.
"""
import re, sys, glob, os, json

SRC = sys.argv[1] if len(sys.argv) > 1 else "subs"
OUT = sys.argv[2] if len(sys.argv) > 2 else "transcripts"
META = "meta.txt"
os.makedirs(OUT, exist_ok=True)

meta = {}
if os.path.exists(META):
    for line in open(META, encoding="utf-8"):
        parts = line.rstrip("\n").split("|", 4)
        if len(parts) == 5:
            meta[parts[0]] = dict(date=parts[1], dur=parts[2], views=parts[3], title=parts[4])

TAG = re.compile(r"<[^>]+>")
TS = re.compile(r"(\d+):(\d+):(\d+)\.(\d+) --> ")

def parse(path):
    cues = []
    cur_t = None
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        m = TS.match(line)
        if m:
            h, mi, s = int(m[1]), int(m[2]), int(m[3])
            cur_t = h * 3600 + mi * 60 + s
            continue
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or cur_t is None:
            continue
        text = TAG.sub("", line).replace("&nbsp;", " ").replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<").strip()
        if text and (not cues or cues[-1][1] != text):
            cues.append((cur_t, text))
    return cues

def stamp(t):
    return f"[{t // 60:02d}:{t % 60:02d}]"

def render(vid, cues):
    m = meta.get(vid, {})
    lines = [f"# {m.get('title', vid)}", f"video: https://www.youtube.com/watch?v={vid}",
             f"date: {m.get('date','?')}  duration_s: {m.get('dur','?')}  views: {m.get('views','?')}", ""]
    buf, start = [], None
    for t, text in cues:
        if start is None:
            start = t
        buf.append(text)
        if t - start >= 30:
            lines.append(f"{stamp(start)} " + " ".join(buf))
            buf, start = [], None
    if buf:
        lines.append(f"{stamp(start)} " + " ".join(buf))
    return "\n".join(lines) + "\n"

index = []
seen = set()
for path in sorted(glob.glob(os.path.join(SRC, "*.vtt"))):
    vid = os.path.basename(path).split(".")[0]
    if vid in seen:
        continue
    seen.add(vid)
    cues = parse(path)
    if not cues:
        continue
    text = render(vid, cues)
    with open(os.path.join(OUT, f"{vid}.md"), "w", encoding="utf-8") as f:
        f.write(text)
    words = sum(len(t.split()) for _, t in cues)
    index.append(dict(id=vid, words=words, **meta.get(vid, {})))

json.dump(index, open(os.path.join(OUT, "_index.json"), "w"), indent=1)
print(f"{len(index)} transcripts, {sum(i['words'] for i in index):,} words")
