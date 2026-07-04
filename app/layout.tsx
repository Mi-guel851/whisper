import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";
import ToastProvider from "@/components/ToastProvider";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
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
    <html lang="en">
      <body className={montserrat.className}>
        <ToastProvider>
          <SplashScreen />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}