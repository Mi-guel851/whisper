import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Whisper",
    short_name: "Whisper",
    description: "Anonymous messages, honestly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#080812",
    theme_color: "#080812",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/ghost.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
