import type { Metadata } from "next";

/** Link previews (Skool, Slack, X) show the share card instead of the generic OG image. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const img = `/r/${id}/card`;
  return {
    title: "Skool Roast report",
    openGraph: { title: "Skool Roast report", description: "An About page graded against what Hormozi and the Skool team actually say.", images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "Skool Roast report", images: [img] },
  };
}

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
