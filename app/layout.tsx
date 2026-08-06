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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{`
          try {
            const resolved = "dark";
            document.documentElement.dataset.themePreference = "dark";
            document.documentElement.dataset.theme = resolved;
            document.documentElement.style.colorScheme = resolved;
          } catch {}
        `}</Script>
        <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
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
              </PushNotificationsProvider>
            </NotificationProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}