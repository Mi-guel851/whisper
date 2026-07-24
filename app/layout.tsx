import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import ToastProvider from "@/components/ToastProvider";
import ThemeProvider from "@/components/ThemeProvider";
import PushNotificationsProvider from "@/components/PushNotificationsProvider";
import ClickHaptics from "@/components/ClickHaptics";
import AppUrlHandler from "@/components/AppUrlHandler";
import OfflineHandler from "@/components/OfflineHandler";

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
    <html lang="en">
      <body>
        <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
        <OfflineHandler />
        <AppUrlHandler />
        <ClickHaptics />
        <ThemeProvider>
          <ToastProvider>
            <PushNotificationsProvider>
              {children}
            </PushNotificationsProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}