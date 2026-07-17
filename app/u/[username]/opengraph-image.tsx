import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 630,
};

export default async function Image({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const title = `@${username}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(135deg, #0f172a 0%, #0b1f3a 40%, #0a3a6d 100%)",
          color: "#ffffff",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: 32,
              background: "#14b8a6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 52,
            }}
          >
            👻
          </div>
          <div>
            <div style={{ fontSize: 48, fontWeight: 800 }}>Whisper</div>
            <div style={{ marginTop: 12, fontSize: 20, color: "#cbd5e1" }}>Send anonymous messages to {title}.</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 }}>
          <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: "-0.04em" }}>Share your Whisper link</div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: "#cbd5e1" }}>
            Anonymous messages, safe identity, beautiful previews for social sharing.
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
