# How the rubric was built (2026-09-02)

1. Pulled captions for all 77 Skool News videos with yt-dlp (76 had captions; #10 had none). `scripts/vtt_to_text.py` dedupes auto-caption overlap into `transcripts/<id>.md` with a [mm:ss] stamp every 30 s.
2. Nine Haiku agents each read a chunk (one per Skool Games event recording, four for the weekly episodes) and extracted checkable rules with speaker, video, timestamp, evidence. Raw output: `rules-raw.json` (502 rules).
3. Added `extra-sources.md` (Hormozi's pinned Small-Big Reminders in Platinum, Nick Saraev's Skool Games post).
4. One Sonnet agent dropped company-facing rules, deduped, kept up to 3 sources per rule, assigned weight 1 to 5 and observable full/partial, and wrote `rubric.json` (55 rules) plus `rubric.md`.

To refresh: re-run steps 1, 2, 4 on new episodes and bump `version` in rubric.json.
