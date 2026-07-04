import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: { username: string };
}) {
  const username = decodeURIComponent(params.username);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#090014",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
          }}
        >
          <img
            src="https://whisper-anonymous.vercel.app/ghost.png"
            width={220}
            height={220}
          />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: 72,
                fontWeight: 800,
              }}
            >
              Whisper
            </div>

            <div
              style={{
                fontSize: 42,
                color: "#67e8f9",
                marginTop: 10,
              }}
            >
              @{username}
            </div>

            <div
              style={{
                marginTop: 28,
                fontSize: 28,
                color: "#d4d4d8",
              }}
            >
              Send anonymous messages 👻
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}