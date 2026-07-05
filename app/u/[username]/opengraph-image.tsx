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

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://whisper-anonymous.vercel.app/u/${username}`,
      siteName: "Whisper",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function UsernameLayout({ children }: Props) {
  return children;
}