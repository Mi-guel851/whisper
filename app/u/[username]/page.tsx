import type { Metadata } from "next";
import ClientPage from "./ClientPage";

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = decodeURIComponent(rawUsername);

  /* Relative, not absolute. `metadataBase` in app/layout.tsx expands these, so
     the production domain is stated once and NEXT_PUBLIC_SITE_URL is honored —
     the three hardcoded https://whisper-anonymous.vercel.app that used to be
     here silently ignored it, which meant a preview deploy advertised the
     production OG image. Encoded because a username reaches this as a decoded
     string and goes back into a URL. */
  const path = `/u/${encodeURIComponent(username)}`;
  const ogImage = `${path}/opengraph-image`;

  return {
    title: `Whisper | @${username}`,
    description: `Send anonymous messages to @${username}.`,

    openGraph: {
      title: `Whisper | @${username}`,
      description: `Send anonymous messages anonymously.`,
      url: path,
      siteName: "Whisper",
      images: [
        {
          url: ogImage,
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
      images: [ogImage],
    },
  };
}

export default function Page() {
  return <ClientPage />;
}