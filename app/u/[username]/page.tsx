import type { Metadata } from "next";
import ClientPage from "./ClientPage";

type Props = {
  params: {
    username: string;
  };
};

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const username = decodeURIComponent(params.username);

  return {
    title: `Whisper | @${username}`,
    description: `Send anonymous messages to @${username}.`,

    openGraph: {
      title: `Whisper | @${username}`,
      description: `Send anonymous messages anonymously.`,
      url: `https://whisper-anonymous.vercel.app/u/${username}`,
      siteName: "Whisper",
      images: [
        {
          url: `https://whisper-anonymous.vercel.app/u/${username}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `Whisper | @${username}`,
        },
      ],
      type: "website",
    },

    twitter: {
      card: "summary_large_image",
      title: `Whisper | @${username}`,
      description: `Send anonymous messages anonymously.`,
      images: [
        `https://whisper-anonymous.vercel.app/u/${username}/opengraph-image`,
      ],
    },
  };
}

export default function Page() {
  return <ClientPage />;
}