import type { Metadata } from "next";

type Props = {
  children: React.ReactNode;
  params: {
    username: string;
  };
};

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const username = params.username;

  return {
    title: `Whisper | @${username}`,
    description: `Send anonymous messages to @${username} on Whisper.`,

    alternates: {
      canonical: `https://whisper-anonymous.vercel.app/u/${username}`,
    },

    openGraph: {
      title: `Whisper | @${username}`,
      description: `Send anonymous messages anonymously.`,
      url: `https://whisper-anonymous.vercel.app/u/${username}`,
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
      title: `Whisper | @${username}`,
      description: `Send anonymous messages anonymously.`,
      images: ["/og-image.png"],
    },
  };
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}