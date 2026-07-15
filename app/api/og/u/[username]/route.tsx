import { ImageResponse } from "next/server";
export const runtime = "edge";

export async function GET(_req: Request, { params }: { params: { username?: string } }) {
  const username = params.username ?? "user";

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #0f172a 0%, #001219 100%)",
          color: "#fff",
          fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        }}
      >
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1 }}>Whisper</div>
          <div style={{ fontSize: 36, marginTop: 10, opacity: 0.95 }}>@{username}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
