export type ThemeId = "midnight" | "pinkBlack" | "ngl";

export type Theme = {
  id: ThemeId;
  name: string;
  bgFrom: string;
  bgVia: string;
  bgTo: string;
  blob1: string;
  blob2: string;
  blob3: string;
  accentFrom: string;
  accentTo: string;
  accentText: string;
  swatch: [string, string, string];
};

export const themes: Record<ThemeId, Theme> = {
  midnight: {
    id: "midnight",
    name: "Midnight",
    bgFrom: "#090014",
    bgVia: "#170033",
    bgTo: "#02000a",
    blob1: "rgba(34, 211, 238, 0.2)",
    blob2: "rgba(147, 51, 234, 0.2)",
    blob3: "rgba(217, 70, 239, 0.1)",
    accentFrom: "#a855f7",
    accentTo: "#22d3ee",
    accentText: "#d8b4fe",
    swatch: ["#170033", "#a855f7", "#22d3ee"],
  },
  pinkBlack: {
    id: "pinkBlack",
    name: "Pink & Black",
    bgFrom: "#0a0006",
    bgVia: "#1a0010",
    bgTo: "#000000",
    blob1: "rgba(236, 72, 153, 0.25)",
    blob2: "rgba(219, 39, 119, 0.2)",
    blob3: "rgba(244, 114, 182, 0.12)",
    accentFrom: "#ec4899",
    accentTo: "#f472b6",
    accentText: "#f9a8d4",
    swatch: ["#000000", "#ec4899", "#f472b6"],
  },
  ngl: {
    id: "ngl",
    name: "NGL Yellow",
    bgFrom: "#0d0d05",
    bgVia: "#1a1a08",
    bgTo: "#000000",
    blob1: "rgba(250, 204, 21, 0.22)",
    blob2: "rgba(234, 179, 8, 0.18)",
    blob3: "rgba(253, 224, 71, 0.1)",
    accentFrom: "#facc15",
    accentTo: "#fde047",
    accentText: "#fde68a",
    swatch: ["#000000", "#facc15", "#fde047"],
  },
};

export const themeList = Object.values(themes);