import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import ToastProvider from "@/components/ToastProvider";
import ThemeProvider from "@/components/ThemeProvider";
import PushNotificationsProvider from "@/components/PushNotificationsProvider";
import SplashScreen from "@/components/SplashScreen";
import ClickHaptics from "@/components/ClickHaptics";
import AppUrlHandler from "@/components/AppUrlHandler";

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
        <SplashScreen />
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