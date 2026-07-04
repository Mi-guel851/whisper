import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background:
            "linear-gradient(135deg,#090014,#170033,#02000A)",
          position: "relative",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "70px",
          color: "white",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            background: "#06b6d4",
            borderRadius: 9999,
            filter: "blur(120px)",
            opacity: 0.25,
            top: -80,
            left: -80,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 78,
              fontWeight: 900,
            }}
          >
            👻 Whisper
          </div>

          <div
            style={{
              marginTop: 25,
              fontSize: 36,
              color: "#cbd5e1",
            }}
          >
            Anonymous Messages & Photos
          </div>

          <div
            style={{
              marginTop: 50,
              display: "flex",
              padding: "18px 32px",
              borderRadius: 9999,
              background: "#22d3ee",
              color: "#000",
              fontWeight: 800,
              fontSize: 28,
            }}
          >
            Send me a message →
          </div>
        </div>

        <div
          style={{
            width: 250,
            height: 250,
            borderRadius: 9999,
            background: "#22d3ee",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 120,
            boxShadow: "0 0 120px rgba(34,211,238,.7)",
          }}
        >
          👻
        </div>
      </div>
    ),
    size
  );
}