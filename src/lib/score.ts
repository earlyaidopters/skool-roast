/** One colour scale for every score badge in the app. */
export function scoreColor(score: number | null | undefined): { bg: string; fg: string; label: string } {
  if (score == null) return { bg: "#e6e6ec", fg: "#17171c", label: "pending" };
  if (score >= 85) return { bg: "#22b35a", fg: "#ffffff", label: "fabulous" };
  if (score >= 70) return { bg: "#4db5f2", fg: "#17171c", label: "solid" };
  if (score >= 50) return { bg: "#eab04b", fg: "#17171c", label: "needs work" };
  return { bg: "#e2482f", fg: "#ffffff", label: "roasted" };
}
