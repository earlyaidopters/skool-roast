"""Generate the light-roast / dark-roast pick images with Nano Banana via REST (no SDK needed)."""
import os, json, base64, urllib.request
KEY = os.environ["GOOGLE_API_KEY"]
MODEL = "gemini-3.1-flash-image"
STYLE = ("Flat playful sticker illustration, thick black outlines, bold flat colors, slight hand-drawn wobble, "
         "pure white background, no text, no letters, no watermark, centered, square composition, friendly modern app mascot style.")
PROMPTS = {
  "light-roast": "A cute smiling coffee cup character, light tan latte, one gentle wisp of steam, relaxed and friendly, small sky-blue and yellow accents. " + STYLE,
  "dark-roast": "A mischievous dark espresso cup character wearing sunglasses, small cartoon flames rising off the top, confident smirk, red and deep blue accents. " + STYLE,
}
for name, prompt in PROMPTS.items():
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"]}}).encode()
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}", data=body, headers={"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=180))
    for part in r["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            open(f"public/img/{name}.png", "wb").write(base64.b64decode(part["inlineData"]["data"])); print("wrote", name); break
