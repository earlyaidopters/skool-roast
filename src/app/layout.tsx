import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Skool Roast",
  description: "Your Skool About page, roasted against what Hormozi and the Skool team actually say.",
  metadataBase: new URL("https://skoolroast.vercel.app"),
  openGraph: { title: "Skool Roast", description: "Paste your Skool link. Get your About page redlined, with the clip behind every note.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "Skool Roast", description: "Paste your Skool link. Get your About page redlined, with the clip behind every note.", images: ["/og.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen antialiased">
        <div className="ember-bg" />
        <div className="grain" />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
