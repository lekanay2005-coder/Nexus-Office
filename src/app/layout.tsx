import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import HackerBackground from "@/components/brand/HackerBackground";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Addendum 6: favicon registered in every size, PWA manifest, theme color for
// mobile chrome, and social preview — all derived from public/logo.png by
// `npm run assets` (scripts/generate-brand-assets.mjs).
export const metadata: Metadata = {
  title: {
    default: "Nexus Office",
    template: "%s · Nexus Office",
  },
  description: "A five-role AI dev team in one office — plan, build, review, ship.",
  manifest: "/manifest.json",
  icons: {
    // Full platform coverage, all derived from public/logo.png by
    // `npm run assets`: standard tabs/bookmarks (16/32), iOS home screen
    // (apple 180), and Android/PWA install (192/512 via manifest.json).
    icon: [
      { url: "/brand/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.png", type: "image/png" },
    ],
    shortcut: "/favicon.png",
    apple: "/brand/icon-180.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus Office",
  },
  openGraph: {
    title: "Nexus Office",
    description: "A five-role AI dev team in one office — plan, build, review, ship.",
    images: [{ url: "/brand/icon-512.png", width: 512, height: 512, alt: "Nexus Office" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <NexusBackdrop />
        <HackerBackground />
        {/* Addendum 14: CRT scanlines + vignette above backdrop/rain, below content. */}
        <div aria-hidden="true" className="crt-overlay" />
      </body>
    </html>
  );
}

// Addendum 6: fixed, full-viewport brand background mounted exactly once at the
// root, so it applies to every page automatically.
//
// - `background-color: #0B0D12` fills the layer instantly (no white flash
//   before the PNG decodes, and a solid fallback on devices that skip the
//   image entirely).
// - `-webkit-` prefixed `background-attachment: fixed` so desktop Safari and
//   iOS Safari agree with the unprefixed rule.
// - On small screens iOS disables fixed attachment (it can paint badly /
//   cost a lot), so it switches to `scroll` while still covering 100% of the
//   viewport via the layer itself (inset-0 + absolute positioning).
// - `pointer-events: none` and `z-index: -1` keep it strictly behind the app
//   shell — clicks, scrolling, and layout are unaffected; `aria-hidden` keeps
//   it out of the a11y tree.
function NexusBackdrop() {
  return <div aria-hidden="true" className="nx-backdrop" />;
}
