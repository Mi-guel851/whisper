import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import ToastProvider from "@/components/ToastProvider";
import ThemeProvider from "@/components/ThemeProvider";
import NotificationProvider from "@/components/NotificationProvider";
import PushNotificationsProvider from "@/components/PushNotificationsProvider";
import ClickHaptics from "@/components/ClickHaptics";
import AppUrlHandler from "@/components/AppUrlHandler";
import OfflineHandler from "@/components/OfflineHandler";
import WhispersAiAssistant from "@/components/ai/WhispersAiAssistant";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  // Whisper leans on 650/700/800 for headings; loading the variable axis
  // keeps that range available without shipping four static files.
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Whisper",
  description: "Anonymous Messaging App",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Runs before first paint, which is the whole point: the stored
            preference has to be on <html> before the browser paints, or a
            light-theme user watches a dark screen repaint itself after
            hydration. This used to hardcode "dark" and ignore the preference
            entirely, so that flash happened on every single load.

            Kept deliberately dependency-free and inline — an import here would
            be a network round trip in front of the first paint. It mirrors
            STORAGE_KEY and the media query in components/ThemeProvider.tsx;
            the two must stay in step. */}
        <Script id="theme-init" strategy="beforeInteractive">{`
          try {
            var stored = localStorage.getItem("whisper-theme");
            var pref = (stored === "light" || stored === "dark" || stored === "system") ? stored : "dark";
            var resolved = pref === "system"
              ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
              : pref;
            document.documentElement.dataset.themePreference = pref;
            document.documentElement.dataset.theme = resolved;
            document.documentElement.style.colorScheme = resolved;
          } catch {}
        `}</Script>
        {/* Paystack's inline.js is NOT loaded here. `window.PaystackPop` is read
            in exactly one place — app/premium/page.tsx — so mounting the script
            in the root layout meant every one of the app's ~48 routes fetched,
            parsed and executed a third-party payment SDK that all but one of
            them never calls. It now loads on /premium itself. */}
        {/* Departure feedback for navigations. The arrival fade lives in
            app/template.tsx; between them a route change is never silent.
            `showSpinner` off — the bar alone is enough, and the corner spinner
            collides with the chat header on mobile. */}
        <NextTopLoader
          color="#a78bfa"
          height={2}
          shadow="0 0 10px #a78bfa, 0 0 5px #a78bfa"
          showSpinner={false}
          speed={260}
          easing="cubic-bezier(0.22, 1, 0.36, 1)"
          zIndex={2000}
        />
        <OfflineHandler />
        <AppUrlHandler />
        <ClickHaptics />
        <ThemeProvider>
          <ToastProvider>
            <NotificationProvider>
              <PushNotificationsProvider>
                {children}
                {/* Mounted here rather than per-page for two reasons: the
                    transcript has to survive a navigation, and it must sit
                    outside app/template.tsx so the route fade can't take its
                    fixed positioning with it. It renders nothing for signed-out
                    visitors and hides itself on the marketing, auth,
                    anonymous-send and chat routes. */}
                <WhispersAiAssistant />
              </PushNotificationsProvider>
            </NotificationProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}