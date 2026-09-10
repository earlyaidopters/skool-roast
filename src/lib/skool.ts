/**
 * Fetch and parse a public Skool community About page.
 * Skool server-renders everything into __NEXT_DATA__, so one GET gives us the
 * headline, about body, video attachment, reviews, pricing, and counts.
 */

export type SkoolReview = {
  rating: number;
  body: string;
  memberSince?: string;
  currentlyPaying?: boolean;
};

export type SkoolAbout = {
  slug: string;
  url: string;
  displayName: string;
  headline: string; // metadata.description (the one-liner under the name)
  body: string; // metadata.lpDescription (the long about copy)
  privacy: "public" | "private" | "unknown";
  totalMembers: number;
  totalAdmins: number;
  totalPosts: number;
  numCourses: number;
  numModules: number;
  reviewCount: number;
  reviewAverageRating: number;
  reviews: SkoolReview[];
  hasVideo: boolean;
  videoUrl?: string;
  videoLengthMs?: number;
  attachmentCount: number;
  imageAttachments: string[];
  coverUrl?: string;
  logoUrl?: string;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  membershipProducts: unknown[];
  surveyQuestions: string[];
  ownerName?: string; // display name of the creator, e.g. "Nick Saraev"
  ownerFirstName?: string;
  ownerBio?: string;
  fetchedAt: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export function normalizeSkoolUrl(input: string): { slug: string; url: string } {
  const trimmed = input.trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let slug = "";
  try {
    const u = new URL(withProto);
    if (!/(^|\.)skool\.com$/i.test(u.hostname)) {
      // treat bare words as slugs
      slug = trimmed.replace(/^@/, "").split(/[/?#]/)[0];
    } else {
      slug = u.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    slug = trimmed.replace(/^@/, "").split(/[/?#]/)[0];
  }
  slug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, "");
  const RESERVED = new Set(["https", "http", "www", "skool", "skoolcom", "about", "login", "signup", "discovery", "games", "pricing", "classroom", "members", "calendar", "leaderboards"]);
  if (!slug || slug.length < 2 || RESERVED.has(slug)) throw new Error("That doesn't look like a Skool community link. Paste something like skool.com/your-community.");
  return { slug, url: `https://www.skool.com/${slug}/about` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Skool stores several metadata fields as JSON strings. */
function parseJson(v: unknown): AnyRec | undefined {
  if (v && typeof v === "object") return v as AnyRec;
  if (typeof v !== "string" || !v.trim()) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

export async function fetchSkoolAbout(input: string): Promise<SkoolAbout> {
  const { slug, url } = normalizeSkoolUrl(input);
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" });
  if (res.status === 404) throw new Error(`No Skool community found at skool.com/${slug}.`);
  if (!res.ok) throw new Error(`Skool returned ${res.status} for ${url}.`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error("Skool page did not include its data payload. Try again in a minute.");
  const data = JSON.parse(m[1]) as AnyRec;
  const pp: AnyRec = data?.props?.pageProps ?? {};
  const group: AnyRec = pp.currentGroup ?? {};
  const md: AnyRec = group.metadata ?? {};
  if (!group.name) throw new Error(`skool.com/${slug} did not load as a community.`);

  const attachments: AnyRec[] = parseJson(md.lpAttachmentsData)?.attachments_data ?? [];
  const mbp = parseJson(md.currentMBp);
  const abp = parseJson(md.currentABp);
  const survey: AnyRec[] = parseJson(md.survey)?.survey ?? [];
  const owner = parseJson(md.owner);
  const om: AnyRec = owner?.metadata ?? {};
  // Only trust a real name. Fall back to the handle only when it is clearly "first-last"; a fused handle like
  // "imjoshhuggett" is not a name and must not be used to address anyone.
  const handle = typeof owner?.name === "string" ? owner.name : "";
  const fromHandle = /^[a-z]{2,}-[a-z]{2,}(-\d+)?$/.test(handle) ? handle.split("-").filter((w: string) => !/^\d+$/.test(w)).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : undefined;
  const rawOwner: string | undefined = [om.first_name, om.last_name].filter(Boolean).join(" ") || om.display_name || fromHandle;
  const ownerName = rawOwner?.replace(/\s*\d+\s*$/, "").trim() || undefined; // Skool appends digits to duplicate handles
  const ownerFirstName = ownerName?.split(" ")[0];
  const video = attachments.find((a) => a?.video?.video_url);
  const images = attachments
    .map((a) => a?.image?.original_url)
    .filter((u: unknown): u is string => typeof u === "string" && u.length > 0);

  const reviewsRaw: AnyRec[] = pp.reviewsData?.reviews ?? [];
  const reviews: SkoolReview[] = reviewsRaw.map((r) => ({
    rating: Number(r.rating ?? 0),
    body: String(r.body ?? ""),
    memberSince: r.memberSince,
    currentlyPaying: r.memberCurrentlyPaying,
  }));

  const privacyMap: Record<number, SkoolAbout["privacy"]> = { 0: "public", 1: "private" };

  return {
    slug: group.name,
    url,
    displayName: md.displayName ?? group.name,
    headline: md.description ?? "",
    body: md.lpDescription ?? "",
    privacy: privacyMap[Number(md.privacy)] ?? "unknown",
    totalMembers: Number(md.totalMembers ?? 0),
    totalAdmins: Number(md.totalAdmins ?? 0),
    totalPosts: Number(md.totalPosts ?? 0),
    numCourses: Number(md.numCourses ?? 0),
    numModules: Number(md.numModules ?? 0),
    reviewCount: Number(md.reviewCount ?? reviews.length),
    reviewAverageRating: Number(md.reviewAverageRating ?? 0),
    reviews,
    hasVideo: Boolean(video),
    videoUrl: video?.video?.video_url,
    videoLengthMs: typeof video?.video?.video_length_ms === "number" ? video.video.video_length_ms : undefined,
    attachmentCount: attachments.length,
    imageAttachments: images,
    coverUrl: md.coverSmallUrl,
    logoUrl: md.logoUrl,
    monthlyPriceCents: typeof mbp?.amount === "number" ? mbp.amount : undefined,
    annualPriceCents: typeof abp?.amount === "number" ? abp.amount : undefined,
    surveyQuestions: survey.map((q) => String(q?.question ?? "")).filter(Boolean),
    ownerName,
    ownerFirstName,
    ownerBio: typeof om.bio === "string" ? om.bio : undefined,
    membershipProducts: pp.groupMembershipProducts ?? [],
    fetchedAt: new Date().toISOString(),
  };
}

/** Compact, model-friendly rendering of the About page for grading prompts. */
export function renderAboutForModel(a: SkoolAbout): string {
  const price = (c?: number) => (typeof c === "number" ? `$${(c / 100).toFixed(0)}` : "not shown");
  const reviewLines = a.reviews
    .slice(0, 12)
    .map((r) => `  - ${r.rating}/5${r.body ? `: ${r.body.slice(0, 200)}` : " (no text)"}`)
    .join("\n");
  return [
    `Community: ${a.displayName} (skool.com/${a.slug})`,
    `Owner: ${a.ownerName ?? "unknown"}${a.ownerBio ? ` (bio: ${a.ownerBio.slice(0, 160)})` : ""}`,
    `Privacy: ${a.privacy}   Members: ${a.totalMembers}   Admins: ${a.totalAdmins}   Posts: ${a.totalPosts}`,
    `Courses: ${a.numCourses}   Modules: ${a.numModules}`,
    `Pricing shown: monthly ${price(a.monthlyPriceCents)}, annual ${price(a.annualPriceCents)}`,
    `Attachments (${a.attachmentCount} of 6 used): slot 1 = ${a.hasVideo ? `video ${a.videoUrl}` : "NO VIDEO"}` +
      a.imageAttachments.map((u, i) => `; slot ${i + 2} = image ${u}`).join(""),
    `Reviews: ${a.reviewCount} (avg ${a.reviewAverageRating})`,
    a.surveyQuestions.length ? `Join questions: ${a.surveyQuestions.join(" | ")}` : "Join questions: none",
    reviewLines ? `Sample reviews:\n${reviewLines}` : "",
    "",
    "HEADLINE (one-liner under the name):",
    a.headline || "(empty)",
    "",
    "ABOUT BODY:",
    a.body || "(empty)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
