import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";
import ToastProvider from "@/components/ToastProvider";
import ThemeProvider from "@/components/ThemeProvider";
import NextTopLoader from "nextjs-toploader";
import ClickHaptics from "@/components/ClickHaptics";

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
        <NextTopLoader color="linear-gradient(to right, #22d3ee, #a855f7)" height={3} showSpinner={false} />
        <ClickHaptics />
        <ThemeProvider>
          <ToastProvider>
            <SplashScreen />
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
