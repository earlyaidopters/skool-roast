# Skool Roast

Read README.md first. Rules for working in this repo:
- Inference runs through the local Codex SDK (`worker/lib/codex-sdk.mjs`). Do not add a paid API key path.
- The worker runs on a machine with a Codex login (a Mac, or the Railway container). The web app is Next.js + Convex only.
- `knowledge/rubric.json` is the grading source of truth. Every rule must cite a real source (speaker, video, timestamp). Never invent advice.
- No em dashes anywhere, including generated copy.
- UI copy is plain and direct. No hype, no AI openers.
