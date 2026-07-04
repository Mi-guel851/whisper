import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

import SplashScreen from "@/components/SplashScreen";
import ToastProvider from "@/components/ToastProvider";
import NextTopLoader from "nextjs-toploader";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://whisper-anonymous.vercel.app"),

  title: {
    default: "Whisper",
    template: "%s | Whisper",
  },

  description: "Send and receive anonymous messages and photos.",

  openGraph: {
    title: "Whisper",
    description: "Send and receive anonymous messages and photos.",
    url: "https://whisper-anonymous.vercel.app",
    siteName: "Whisper",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Whisper",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Whisper",
    description: "Send and receive anonymous messages and photos.",
    images: ["/og-image.png"],
  },

  icons: {
    icon: "/ghost.png",
    shortcut: "/ghost.png",
    apple: "/ghost.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={montserrat.className}>
        <NextTopLoader
          color="#22d3ee"
          height={3}
          showSpinner={false}
        />

        <ToastProvider>
          <SplashScreen />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}