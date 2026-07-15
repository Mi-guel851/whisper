import type { Metadata } from "next";

type Props = {
  params: Promise<{ username: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = decodeURIComponent(rawUsername);

  const title = `Whisper | @${username}`;
  const description = `Send @${username} an anonymous message on Whisper 👻`;

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app";
  const profileUrl = `${baseUrl}/u/${username}`;
  // Use the API-based OG route to avoid filename conflicts with page files
  const ogImage = `${baseUrl}/api/og/u/${username}`;

  return {
    title,
    description,
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title,
      description,
      url: profileUrl,
      siteName: "Whisper",
      type: "website",
      images: [
        {
          url: ogImage,
          alt: `Whisper | @${username}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function ProfileLayout({ children }: Props) {
  return children;
}
