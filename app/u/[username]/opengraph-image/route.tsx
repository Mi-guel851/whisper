import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(_req: Request) {
  const imageData = await readFile(join(process.cwd(), "public", "og-image.png"));
  const base64 = `data:image/png;base64,${imageData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
        }}
      >
        <img
          src={base64}
          style={{
            width: 1200,
            height: 630,
            objectFit: "cover",
          }}
        />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}