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
  title: "Whisper — Anonymous Messaging",
  description: "Create your anonymous profile, receive honest messages, anonymous images, and discover what people really think of you.",
  openGraph: {
    title: "Whisper — Anonymous Messaging",
    description: "Create your anonymous profile, receive honest messages, anonymous images, and discover what people really think of you.",
    url: "https://whisper-anonymous.vercel.app",
    siteName: "Whisper",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Whisper — Anonymous Messaging",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whisper — Anonymous Messaging",
    description: "Create your anonymous profile, receive honest messages, anonymous images, and discover what people really think of you.",
    images: ["/opengraph-image.png"],
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
        <NextTopLoader color="linear-gradient(to right, #22d3ee, #a855f7)" height={3} showSpinner={false} />
        <ToastProvider>
          <SplashScreen />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}