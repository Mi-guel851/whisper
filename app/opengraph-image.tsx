import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app";
  const imageUrl = new URL("/og-image.png", baseUrl).toString();

  return new ImageResponse(
    (
      <img
        src={imageUrl}
        alt="Whisper"
        width="1200"
        height="630"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    ),
    size
  );
}
