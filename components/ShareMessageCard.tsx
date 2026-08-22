"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas-pro";
import { X, Download, Image as ImageIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";

import useWhisperShare from "@/lib/useWhisperShare";
import SocialIcon, {
  SOCIAL_LABELS,
  SOCIAL_SURFACES,
  type SocialPlatform,
} from "@/components/SocialIcon";

/* A subset of the app's social platforms — Facebook has no image-share intent
   worth offering here, so it is deliberately absent. Deriving the type from
   `SocialPlatform` rather than re-listing the strings means a platform can never
   be named here that has no mark to render. */
type Platform = Extract<
  SocialPlatform,
  "instagram" | "snapchat" | "whatsapp" | "x" | "tiktok"
>;

/**
 * Whisper's own cyan → violet → pink, used for the prompt band and the canvas
 * glow when a caller doesn't name its own.
 */
const DEFAULT_ACCENT = ["#22d3ee", "#8b5cf6", "#ec4899"];

/** The invitation on an anonymous whisper. Game and prompt cards pass their own. */
const DEFAULT_PROMPT = "send me anonymous messages!";

/* ---------------------------------------------------------------------------
   Export format.

   This was PNG, and a 1080x1920 canvas of smooth gradients is close to the worst
   case for it: almost nothing repeats, so the filter stage has little to predict
   and the file lands somewhere between 1.5 and 3 MB. That size is a wait three
   times over — encoding it, handing it to the share sheet, and uploading it — and
   it is why a tap on a platform button felt like it had missed.

   JPEG at q0.9 puts the same card in the low hundreds of KB. Nothing that matters
   here is lost: the canvas is opaque, so there is no transparency to preserve
   (html2canvas is already told to flatten onto black), and at this quality the
   only place the difference is even findable is the hard edge of the wordmark,
   which is large and high-contrast enough to survive it.
   --------------------------------------------------------------------------- */
const EXPORT_MIME = "image/jpeg";
const EXPORT_QUALITY = 0.9;
const EXPORT_NAME = "whisper-message.jpg";

/**
 * `#rrggbb` → `rgba(r, g, b, a)`.
 *
 * Done in JS rather than with `color-mix()` for one reason: html2canvas reads
 * computed styles, and Chrome does not always resolve `color-mix()` inside a
 * gradient when it serializes one — so the stop that looks right in the preview
 * can come back as nothing in the exported PNG. A literal rgba() cannot be
 * misread. Non-hex input is returned untouched so a caller passing an already
 * valid colour keyword still works.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ---------------------------------------------------------------------------
   One layout, two sizes.

   Every measurement below is written against a 1080x1920 story canvas — the
   format Instagram, Snapchat and TikTok all expect — and multiplied by a single
   scale factor derived from however much room the preview actually has. So the
   preview and the exported PNG are the same layout rendered at two sizes, not
   two layouts that have to be kept in agreement by hand.

   That matters for more than tidiness. With fixed pixel sizes the message
   wrapped after a different word on a 360px phone than it did in the 1080px
   export, so the file never quite matched the card the user pressed save on.
   --------------------------------------------------------------------------- */
const CANVAS_W = 1080;
const CANVAS_H = 1920;

/** Left/right canvas margin, which lands the card at 864 wide. */
const CANVAS_PAD_X = 108;

/* ---------------------------------------------------------------------------
   Brand assets for the watermark.

   These replace an inline SVG ghost and the wordmark set in whatever sans-serif
   the device happened to have. That pairing is what made the signature read as a
   mockup rather than a brand: a system font is not the logotype, and it changed
   shape between an iPhone and an Android.

   The previous inline vector existed for a real reason — the version before it
   was `next/image` on `/ghost.png` with `grayscale invert` applied, and
   html2canvas has to both re-fetch that URL and re-apply the filters inside its
   own clone. When either step missed, the export landed with a hole where the
   logo should be. Two things make the image safe here: no CSS filter is involved
   at all, and `getImageBlob` already awaits `decode()` on every `<img>` in the
   frame before capturing, so a half-loaded asset cannot be rasterized.

   The space in the wordmark's filename is percent-encoded deliberately. A literal
   space works in most browsers, but html2canvas re-resolves every URL in its
   clone, and that is not a place to rely on lenient parsing.
   --------------------------------------------------------------------------- */
const GHOST_SRC = "/ghost.png";
const WORDMARK_SRC = "/share-message-card%20text.png";

/**
 * How much of the wordmark asset is transparent margin on each side.
 *
 * Measured off the PNG: the glyphs occupy roughly the middle 54% of its width and
 * 44% of its height, centred. That padding is invisible but it still takes up
 * layout space, so a flex `gap` alone would leave an ~88px hole between the ghost
 * and the W. The negative margins below cancel it symmetrically, which keeps the
 * lockup optically centred even if this estimate is a few percent out.
 */
const WORDMARK_SIDE_TRIM = 0.23;

/** Rendered height of the wordmark box. The glyphs land at ~44% of it. */
const WORDMARK_BOX_H = 128;

function PlatformIcon({ platform }: { platform: Platform }) {
  return <SocialIcon platform={platform} size={22} />;
}

/**
 * Message type size, in canvas units.
 *
 * A photo and full-size text cannot both have the room they want inside a frame
 * whose height is fixed at 9:16. The text is what gives way, because it is the
 * part that can reflow — cropping the photo instead would damage the thing being
 * shared.
 */
function messageSize(length: number, hasImage: boolean): number {
  const ramp = [
    { max: 40, size: 70 },
    { max: 80, size: 58 },
    { max: 140, size: 47 },
    { max: 220, size: 39 },
    { max: 400, size: 31 },
  ];
  const base = ramp.find((step) => length <= step.max)?.size ?? 26;
  return hasImage ? Math.round(base * 0.78) : base;
}

/**
 * The thing that gets rasterized: a full story canvas, the card centred in it,
 * the Whisper watermark along the bottom.
 *
 * Two rules govern everything inside, both imposed by html2canvas rather than by
 * taste. It cannot rasterize `backdrop-filter`, so the glass has to be real
 * translucency compositing over the canvas gradient behind it. And it skips
 * `box-shadow` outright, so every lit edge is a gradient stop — a shadow-lit rim
 * shows in the preview and is simply absent from the saved file, which is how
 * the download used to come out flatter than what was on screen.
 */
function StoryFrame({
  message,
  imageUrl,
  width,
  frameRef,
  prompt,
  accent,
  light,
  variant = "export",
}: {
  message: string;
  imageUrl?: string | null;
  width: number;
  frameRef?: React.RefObject<HTMLDivElement | null>;
  prompt: string;
  accent: string[];
  /** Light theme — skins the message half only. See the note on that half. */
  light: boolean;
  /**
   * Which of the two jobs this frame is doing.
   *
   * `export` is the full story plate: glossy black canvas, colour wash, Whisper
   * watermark — 1080x1920 and ready to post. `preview` is the same card with all
   * of that stripped away, so on screen the user sees the card itself sitting in
   * the sheet's glass rather than a black rectangle inside a black rectangle.
   *
   * They are two frames rendered at once, not one frame restyled, because the
   * export has to keep the plate while the preview drops it. See the render.
   */
  variant?: "preview" | "export";
}) {
  /* One factor for the whole tree, applied as plain px in inline styles — so the
     computed values html2canvas reads are already absolute, with no container
     query or relative unit that could resolve differently inside its clone. */
  const s = width / CANVAS_W;
  const u = (n: number) => `${n * s}px`;
  const hasImage = Boolean(imageUrl);

  /* Two stops or three, both read as one sweep. A caller with a two-stop brand
     colour — a game tile, say — gets its own hue across the band without having
     to invent a middle. */
  const band = accent.length > 1 ? accent : [accent[0], accent[0]];
  const bandStops = band
    .map((stop, index) => `${stop} ${Math.round((index / (band.length - 1)) * 100)}%`)
    .join(", ");

  /* The canvas glow, keyed off the same three colours the band uses so a tinted
     card is tinted all the way through rather than a coloured strip pasted onto
     Whisper's default backdrop. Alphas stay where they were — low enough that
     this stays black with a colour in it. */
  const glow = [band[0], band[band.length - 1], band[Math.floor(band.length / 2)]];

  /* One flag, read in the four places the two variants diverge. */
  const isExport = variant === "export";

  return (
    <div
      ref={frameRef}
      style={{
        /* Explicit pixels rather than `aspect-ratio` and flex: html2canvas lays
           its clone out in its own iframe, where an ancestor-dependent size can
           resolve to something else entirely. A stated size cannot drift. */
        width: `${width}px`,
        height: `${(width * CANVAS_H) / CANVAS_W}px`,
        position: "relative",
        overflow: "hidden",
        borderRadius: u(28),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        /* Glossy black — but only on the frame that gets saved.
           Two layers doing two jobs: a soft sheen falling from just above the top
           edge, which is what reads as lacquer rather than matte paint, over a
           black body that is never quite #000 until the very bottom — a flat
           black canvas kills the card's own edge light and the whole thing goes
           shapeless.

           The preview leaves it transparent so the sheet's own glass is what sits
           behind the card. A black plate inside a dark glass panel inside a dark
           scrim was three dark rectangles deep, and the card — the thing the user
           actually came to look at — was the smallest of them. */
        background: isExport
          ? "radial-gradient(125% 72% at 50% -8%, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.055) 26%, rgba(255,255,255,0) 58%), " +
            "linear-gradient(168deg, #15161b 0%, #0b0c10 34%, #050507 68%, #000000 100%)"
          : "transparent",
      }}
    >
      {/* Painted, never blurred — see the note on this component. Alphas are
          roughly half what they were on the indigo canvas: the same values over
          black read as a colour wash rather than a bloom, and the point is that
          this is black with Whisper in it, not purple.

          Export only: this wash is lit *by* the black plate. Over the sheet's
          glass with no plate under it there is nothing for it to wash, and it
          would only add a faint haze across the panel. */}
      {isExport && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              `radial-gradient(78% 42% at 12% 3%, ${withAlpha(glow[0], 0.13)} 0%, ${withAlpha(glow[0], 0)} 62%), ` +
              `radial-gradient(84% 44% at 93% 70%, ${withAlpha(glow[1], 0.12)} 0%, ${withAlpha(glow[1], 0)} 64%), ` +
              `radial-gradient(70% 38% at 50% 101%, ${withAlpha(glow[2], 0.12)} 0%, ${withAlpha(glow[2], 0)} 66%)`,
          }}
        />
      )}

      {/* Card region. Takes the slack above the watermark, so the card lands in
          the same place whatever height it ends up at. */}
      <div
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          /* No watermark below it in the preview, so there is no reserved strip to
             balance against — the card simply centres in the frame. */
          justifyContent: isExport ? "flex-start" : "center",
          padding: isExport
            ? `${u(72)} ${u(CANVAS_PAD_X)} 0`
            : `${u(24)} ${u(CANVAS_PAD_X)}`,
        }}
      >
        {/* Weighted spacers rather than `justify-content: center`, because the
            reference sits its card in the upper third and dead-centre reads as a
            different composition. Uneven flex-grow on two zero-basis spacers
            gives that bias for a short card, and collapses to nothing once a tall
            photo needs the whole region — so biasing the layout costs a tall card
            no room, which a fixed top offset or an asymmetric padding would. */}
        {isExport && <div aria-hidden style={{ flex: "1 1 0", minHeight: 0 }} />}

        <div
          style={{
            width: "100%",
            flex: "0 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            /* One rounded rectangle with the two halves flush inside it, which is
               the shape in the reference — not the two separately rounded panels
               with a gap between them that this used to be. */
            borderRadius: u(48),
            overflow: "hidden",
            border: `${u(2)} solid rgba(255,255,255,0.10)`,
          }}
        >
          {/* The prompt, centred and set large so it reads as the invitation the
              card is built around rather than as a caption. The band carries
              whatever colour the caller sends — a game question arrives tinted to
              the tile it was tapped on; an anonymous whisper falls back to
              Whisper's cyan → violet → pink.

              Centred rather than ragged-left, and centred by two properties on
              purpose: `justifyContent` centres the paragraph box itself and
              `textAlign` centres each line inside it. Either alone is not enough
              — a flex item's width here depends on whether the text is short
              enough to fit one line, so a one-line prompt and a three-line one
              would land differently. Pinning the box to the full width and
              centring the lines within it is the same result at any length. */}
          <div
            style={{
              flexShrink: 0,
              minHeight: u(248),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `${u(52)} ${u(56)}`,
              background: `linear-gradient(118deg, ${bandStops})`,
            }}
          >
            <p
              style={{
                margin: 0,
                width: "100%",
                /* A game question is a sentence, not a four-word invitation, so
                   the band steps down a size once it gets long rather than
                   growing the band and squeezing the card below it. */
                fontSize: u(prompt.length > 64 ? 36 : prompt.length > 42 ? 41 : 46),
                lineHeight: 1.18,
                fontWeight: 900,
                letterSpacing: "-0.015em",
                textAlign: "center",
                color: "#ffffff",
                overflowWrap: "anywhere",
              }}
            >
              {prompt}
            </p>
          </div>

          {/* The message half, and the one part of the card that follows the app's
              theme.

              On dark it is translucent white compositing over the canvas gradient
              behind it — alpha blending, which rasterizes exactly, rather than a
              blur that would not. On light it becomes an opaque near-white sheet,
              so the half where the message is read matches the theme the user is
              reading the app in.

              Only this half moves. The band above keeps its colour in both themes
              and the canvas stays glossy black in both, which is deliberate on
              three counts: glossy black is what was asked for, it is what the
              reference actually does — a coloured header over a white body, on a
              dark story canvas — and the watermark below is a white wordmark
              beside a dark-backed ghost tile that cannot be recoloured, because
              html2canvas ignores CSS filters and blend modes.

              The first gradient layer in each theme is the seam under the band: a
              rim light on dark, a soft shadow on light. A stop rather than an
              inset shadow because html2canvas skips `box-shadow` outright. */}
          <div
            style={{
              position: "relative",
              flex: "1 1 auto",
              minHeight: u(330),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: u(38),
              padding: `${u(64)} ${u(56)}`,
              textAlign: "center",
              background: light
                ? `linear-gradient(to bottom, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0) ${u(4)}), ` +
                  /* Opaque, and not flat #ffffff all the way down: a hair of cool
                     drift keeps it reading as a lit surface rather than paper. */
                  "linear-gradient(162deg, #ffffff 0%, #f8f9fd 54%, #f1f3fa 100%)"
                : `linear-gradient(to bottom, rgba(255,255,255,0.34) 0px, rgba(255,255,255,0) ${u(3)}), ` +
                  "linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.085) 48%, rgba(255,255,255,0.055) 100%)",
            }}
          >
            {message ? (
              <p
                style={{
                  margin: 0,
                  fontSize: u(messageSize(message.length, hasImage)),
                  lineHeight: 1.32,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  color: light ? "#0b0c14" : "#ffffff",
                  overflowWrap: "anywhere",
                  /* The dark half's text sits on a translucent surface with the
                     canvas showing through, so it needs the shadow to hold its
                     edge. On an opaque white sheet the same shadow just smudges
                     it. */
                  textShadow: light ? "none" : `0 ${u(2)} ${u(6)} rgba(4,8,26,0.42)`,
                }}
              >
                {message}
              </p>
            ) : hasImage ? null : (
              /* Only when there is genuinely nothing. A photo with no caption is
                 a complete whisper, so labelling it "no message" would be telling
                 the user their card is broken when it isn't. */
              <p
                style={{
                  margin: 0,
                  fontSize: u(38),
                  fontWeight: 700,
                  fontStyle: "italic",
                  color: light ? "rgba(11,12,20,0.42)" : "rgba(255,255,255,0.55)",
                }}
              >
                No message text
              </p>
            )}

            {imageUrl && (
              /* A plain <img>, not next/image: the optimizer wraps it in sized
                 spans and can serve it from a different origin, and html2canvas
                 has to re-resolve both inside its clone. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                crossOrigin="anonymous"
                alt="Anonymous attachment"
                style={{
                  display: "block",
                  width: "auto",
                  maxWidth: "100%",
                  /* This is how the card adjusts to the photo: contain plus a
                     height ceiling, so a landscape shot makes a short wide card
                     and a portrait one makes a tall card, and neither can push
                     the watermark off the canvas. The ceiling is lower when there
                     is also text to fit. */
                  maxHeight: u(message ? 620 : 900),
                  objectFit: "contain",
                  borderRadius: u(32),
                  /* A white rim reads as light catching the edge on the dark
                     half and as nothing at all on the light one, so the light
                     theme gets a dark hairline instead. */
                  border: `${u(2)} solid ${light ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.18)"}`,
                }}
              />
            )}
          </div>
        </div>

        {/* Grows faster than the spacer above it, which is what lifts the card
            into the upper third. */}
        {isExport && <div aria-hidden style={{ flex: "2.4 1 0", minHeight: 0 }} />}
      </div>

      {/* Watermark, on the canvas rather than inside the card — the reference
          signs the story, not the message.

          Export only. The ghost is a square asset with its own dark backdrop
          baked in (it cannot be knocked out — html2canvas ignores blend modes,
          see the note on the img), so with no black plate under it the badge
          would read as a dark rectangle floating on the glass. The saved file is
          where the signature belongs; the preview is where the card belongs. */}
      {isExport && (
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: u(20),
          padding: `${u(56)} 0 ${u(104)}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={GHOST_SRC}
            alt=""
            aria-hidden
            style={{
              display: "block",
              width: u(92),
              height: u(92),
              /* The asset is a square tile with its own dark backdrop and cyan
                 glow, not a cut-out. Rounding it into a squircle turns that from
                 a pasted rectangle into an app-icon badge, which is the one
                 reading that looks deliberate on a black canvas.
                 `mixBlendMode: "screen"` would drop the backdrop entirely and
                 looks better in the preview — but html2canvas ignores blend
                 modes, so the saved file would not match the card the user
                 pressed save on, which is the exact bug this whole component was
                 rebuilt to remove. */
              borderRadius: u(26),
              objectFit: "cover",
              border: `${u(1.5)} solid rgba(255,255,255,0.16)`,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={WORDMARK_SRC}
            alt="Whisper"
            style={{
              display: "block",
              /* Sized by height, not width: the asset's box is far larger than
                 its glyphs, so a width would size the padding rather than the
                 logotype. */
              height: u(WORDMARK_BOX_H),
              width: "auto",
              /* Cancels the asset's own transparent margin. Symmetric on purpose —
                 see WORDMARK_SIDE_TRIM. The +26 leaves a real optical gap between
                 the badge and the W. */
              marginLeft: u(-(WORDMARK_BOX_H * 2.98 * WORDMARK_SIDE_TRIM) + 26),
              marginRight: u(-(WORDMARK_BOX_H * 2.98 * WORDMARK_SIDE_TRIM)),
            }}
          />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: u(21),
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.42em",
            lineHeight: 1,
            color: "rgba(255,255,255,0.52)",
            /* Tracking adds a trailing gap after the last letter, which drags a
               centred line visibly left. Indenting by the same amount puts the
               optical centre back where the geometric one is. */
            textIndent: "0.42em",
          }}
        >
          anonymous q&amp;a
        </p>
      </div>
      )}
    </div>
  );
}

/**
 * Whether the app is currently in light theme.
 *
 * Read straight off `<html data-theme>` rather than through `useTheme()`, and
 * that is not a shortcut. `ThemeProvider` initialises `resolvedTheme` to `"dark"`
 * and only corrects it after `supabase.auth.getSession()` and a profiles query
 * have both resolved — so a light-theme user would watch this card open dark and
 * flip a moment later, which is worse than either theme on its own.
 *
 * The attribute is set by the pre-paint script in the root layout, so it is
 * already right on the first commit. It is also what the CSS itself keys off, and
 * what html2canvas will read out of the clone, which keeps the exported file
 * matching the card the user pressed save on.
 *
 * The observer is there for the case where the user changes theme with the card
 * open — rare, but the alternative is a card that disagrees with the app behind
 * it, and it costs one listener.
 */
function useLightTheme(): boolean {
  const [light, setLight] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.dataset.theme === "light"
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLight(root.dataset.theme === "light");
    /* Once on mount as well as on change: the pre-paint script and this
       component's first render are not ordered relative to each other. */
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return light;
}

export default function ShareMessageCard({
  message,
  imageUrl,
  onClose,
  prompt = DEFAULT_PROMPT,
  accent = DEFAULT_ACCENT,
  shareUrl,
  shareText,
}: {
  message: string;
  imageUrl?: string | null;
  onClose: () => void;
  /** The invitation across the coloured band. A game passes its question here. */
  prompt?: string;
  /** Two or three hex stops. Tints the band and the canvas glow. */
  accent?: string[];
  /** The link that travels with the card. Defaults to the viewer's own Whisper. */
  shareUrl?: string;
  /** Overrides the header text in the caption. Defaults to the prompt. */
  shareText?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");
  const light = useLightTheme();

  /* Resolved here rather than left to each caller, so the two call sites that
     open this card on a *received* whisper — Recent Messages and Notifications —
     share the viewer's own link without either page having to know that is what
     a share is for. Callers that already have the link pass it as `shareUrl` and
     that still wins. */
  const { link: ownLink } = useWhisperShare();

  /* ---------------------------------------------------------------------------
     What the caption says.

     The header text, then the user's link. Never the message body, which is what
     this used to send: a caption that quotes the whisper it is showing a picture
     of spends the post's one readable line on text the image already carries, and
     leaves the reader nothing to tap — so the share earned Whisper nothing. The
     band's invitation plus a link is the ask, and the image is a picture of the
     ask.

     The blank line before the URL is not cosmetic. WhatsApp, Instagram and X all
     linkify a trailing URL and leave the text above it alone; inline, the question
     and the link fight and one of them loses. Same reasoning as `composeMessage`
     in `useWhisperShare`.
     --------------------------------------------------------------------------- */
  const shareHeadline = shareText ?? prompt;
  const shareDestination =
    shareUrl || ownLink || (typeof window === "undefined" ? "" : window.location.origin);
  const shareCaption = shareDestination
    ? `${shareHeadline}\n\n${shareDestination}`
    : shareHeadline;

  /* The portal host, resolved in the initial state rather than in an effect so
     the card paints on its first commit — an effect would cost a frame of empty
     overlay every time it opens. `undefined` on the server, where there is no
     document; this component only ever mounts behind a click, so that branch is
     for safety rather than for a real server render. */
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  /* Escape closes, and the page behind cannot scroll while it is open. Both are
     new consequences of portalling to <body>: the card used to be a child of the
     card that opened it, which is also why it was mis-sized — see the note on
     the return. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  /**
   * Fits the story frame to whatever height the modal has left over.
   *
   * The width is quantized to a multiple of 9 so that 16/9 lands on a whole
   * number of pixels on both sides. That makes the export exactly 1080x1920
   * rather than a pixel over, which matters because the story surfaces re-crop
   * anything that is not precisely 9:16.
   *
   * useLayoutEffect, not useEffect: measuring after paint would show one frame of
   * a wrongly-sized card. The component only ever mounts behind a client state
   * flag, so there is no server render for it to warn about.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const measure = () => {
      const unit = Math.floor(Math.min(box.clientWidth / 9, box.clientHeight / 16));
      /* Below this the type is unreadable anyway — landscape on a short phone —
         so it renders nothing rather than a smudge. */
      const next = unit >= 8 ? unit * 9 : 0;
      setFrameWidth((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  function flashToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2800);
  }

  /**
   * Rasterizes the story frame.
   *
   * Capture used to run before webfonts and the attached photo had resolved, so
   * the text rendered in a fallback face and the photo could land as a blank
   * box. Both are waited on here.
   *
   * A `useCallback` with no dependencies — it reads nothing but refs — so the
   * pre-warm effect below can depend on it without re-rendering the card into a
   * capture loop.
   */
  const getImageBlob = useCallback(async (): Promise<Blob | null> => {
    const card = cardRef.current;
    if (!card) return null;

    await Promise.all([
      document.fonts?.ready?.catch(() => undefined),
      ...Array.from(card.querySelectorAll("img")).map((img) =>
        img.complete ? img.decode().catch(() => undefined) : new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
      ),
    ]);

    /* `offsetWidth` truncates to a whole pixel, which shaves the right and bottom
       edges of a fractionally-sized box. The frame is sized in whole pixels now,
       but rounding up costs nothing and keeps that from coming back if the sizing
       ever changes. */
    const rect = card.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    /* The frame lays out at a few hundred CSS px, so a 1:1 capture is a
       thumbnail — soft the moment it is posted full-bleed to a story, which is
       the whole reason the download read as low quality. Scaling to CANVAS_W
       lands it at exactly the 1080x1920 every social surface expects.
       iOS caps a canvas side at ~4096px and going over doesn't throw — it hands
       back an empty bitmap, which is what made tall cards download blank. So the
       target is a floor and the cap is a ceiling, and the ceiling wins. */
    const scale = Math.max(
      1,
      Math.min(CANVAS_W / width, 4096 / Math.max(width, height))
    );

    const canvas = await html2canvas(card, {
      /* Shows only through the frame's rounded corners, so it tracks the frame's
         own darkest stop — now that the canvas is glossy black, that is black.
         Not `null`: a transparent PNG gets flattened to white or black by
         whichever app it lands in, which is a bug with an extra step. */
      backgroundColor: "#000000",
      scale,
      useCORS: true,
      logging: false,
      width,
      height,
      /* The frame is inside a flex modal. Without pinning the scroll origin,
         html2canvas measures against the document's scroll position and captures
         an offset region — a card sliced across the top with a band of empty
         background at the bottom. */
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });

    /* `toBlob` hands back null when the canvas is tainted or allocation failed.
       Returning it as-is would surface as a silent no-op download, so the
       caller's null branch is the one that reports it. */
    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), EXPORT_MIME, EXPORT_QUALITY)
    );
  }, []);

  /* ---------------------------------------------------------------------------
     The pre-warmed export.

     Everything that changes a pixel of the frame is in the key, because a stale
     hit would hand off the previous card — which is a worse bug than the slow
     render this replaces.
     --------------------------------------------------------------------------- */
  const exportKey = `${frameWidth}|${light ? "light" : "dark"}|${prompt}|${message}|${
    imageUrl ?? ""
  }|${accent.join(",")}`;
  const blobRef = useRef<Blob | null>(null);
  const blobKeyRef = useRef("");
  /* The newest key, readable from inside a render that is still in flight. */
  const latestKeyRef = useRef(exportKey);
  const pendingRef = useRef<{ key: string; run: Promise<Blob | null> } | null>(null);

  /**
   * Rasterizes the card, at most once per key at a time.
   *
   * The de-duplication is not a micro-optimisation. Without it, a tap that lands
   * during the pre-warm starts a second 1080x1920 rasterization beside the first
   * — double the work on any phone, and an allocation failure on a tight one,
   * which surfaces as a blank card.
   */
  const startRender = useCallback((): Promise<Blob | null> => {
    const pending = pendingRef.current;
    if (pending && pending.key === exportKey) return pending.run;

    const key = exportKey;
    const run = getImageBlob()
      .then((blob) => {
        /* A render that outlived the thing it was a picture of — the theme
           flipped, or the caller swapped the message under it. Dropping it costs
           one wasted capture; publishing it would hand the user a card that is
           not the one on screen. */
        if (blob && latestKeyRef.current === key) {
          blobRef.current = blob;
          blobKeyRef.current = key;
        }
        return blob;
      })
      .catch((error) => {
        console.error("Share card render failed:", error);
        return null;
      })
      .finally(() => {
        if (pendingRef.current?.key === key) pendingRef.current = null;
      });

    pendingRef.current = { key, run };
    return run;
  }, [getImageBlob, exportKey]);

  /**
   * Renders the card once in the background as soon as it has a size.
   *
   * This is the other half of "shared immediately". Rasterizing 1080x1920 takes
   * 300-800ms on a phone, and doing it *after* the tap cost more than the wait:
   * a browser's transient user activation survives microtasks but not a task that
   * long, so `navigator.share` was liable to be refused outright by the time it
   * was reached — the tap that looked slow could also end in nothing at all.
   * Doing it before the tap means the tap has nothing to wait for.
   */
  useEffect(() => {
    /* Set before anything else in here, so an in-flight render from the previous
       key can already see that it has been superseded. */
    latestKeyRef.current = exportKey;
    if (!frameWidth) return;

    /* Invalidate on the way in. If nothing changed but the theme flipped, the old
       blob is still a valid image — of a card that is no longer on screen. */
    if (blobKeyRef.current !== exportKey) blobRef.current = null;

    let inner = 0;
    /* Two frames, not zero. The render that changed `exportKey` still has to
       paint before html2canvas can read it, and starting a capture on the same
       frame the card first appears on would stall that appearance. */
    const outer = requestAnimationFrame(() => {
      /* No error branch: nothing was asked for yet, and `startRender` already
         logs. A real failure is reported when a button is actually pressed. */
      inner = requestAnimationFrame(() => void startRender());
    });

    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [exportKey, frameWidth, startRender]);

  /**
   * The pre-warmed blob, or null.
   *
   * Synchronous, and every caller has to read it *before* its first `await` —
   * that is the whole point. See the effect above.
   */
  function cachedBlob(): Blob | null {
    return blobKeyRef.current === exportKey ? blobRef.current : null;
  }

  /** Renders the card now, with the spinner on, and reports a failure. */
  async function renderBlob(): Promise<Blob | null> {
    setGenerating(true);
    const blob = await startRender();
    setGenerating(false);
    if (!blob) {
      /* A failed render used to end in silence, so the button read as dead. */
      flashToast("Couldn't build the card. Try again.");
      return null;
    }
    return blob;
  }

  /**
   * Saves a blob to disk.
   *
   * The link has to be in the document and the object URL has to outlive the
   * click: Firefox ignores a click on a detached anchor, and revoking the URL in
   * the same tick cancels the download in Chromium before it starts. Both
   * failure modes look identical to the user — the button does nothing.
   */
  function downloadBlob(blob: Blob, fileName = EXPORT_NAME) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function handleDownload() {
    /* Cache first, so the common case is a save with no spinner at all. */
    const blob = cachedBlob() ?? (await renderBlob());
    if (!blob) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-${Date.now()}.jpg`;
          try {
            const savedFile = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: Directory.Documents,
              recursive: true,
            });
            await Share.share({ title: "Save Whisper", text: "Anonymous Whisper", url: savedFile.uri });
            flashToast("Image generated! 📥");
          } catch (writeErr) {
            console.error("Write error:", writeErr);
            flashToast("Permission error. Check app settings.");
          }
        };
      } catch (err) {
        console.error("Save error:", err);
        flashToast("Couldn't save image.");
      }
    } else {
      downloadBlob(blob);
      flashToast("Saved to your device 📥");
    }
  }

  async function handleSaveAttachment() {
    if (!imageUrl) return;
    setGenerating(true);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-photo-${Date.now()}.jpg`;
          const savedFile = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Documents, recursive: true });
          await Share.share({ title: "Save Photo", url: savedFile.uri });
          flashToast("Photo saved! 📷");
        };
      } else {
        downloadBlob(blob, "whisper-photo.jpg");
        flashToast("Photo saved! 📷");
      }
    } catch (err) {
      console.error(err);
      flashToast("Couldn't save photo.");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Opens the OS share sheet with the card attached.
   *
   * `false` covers all three ways this can not happen — no sheet on this browser,
   * the sheet refusing a file, and the user cancelling — because the caller's next
   * move is the same in every case.
   *
   * Async, but `navigator.share` still runs in the caller's task: an async
   * function body runs synchronously up to its first `await`, and the only `await`
   * here is on the promise `share()` already returned. That is what lets the
   * pre-warmed path keep the browser's user activation.
   */
  async function shareViaSheet(blob: Blob): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.share) return false;
    const file = new File([blob], EXPORT_NAME, { type: EXPORT_MIME });
    if (!navigator.canShare?.({ files: [file] })) return false;
    try {
      await navigator.share({ files: [file], title: "Whisper", text: shareCaption });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * No share sheet available, so the card is saved and the platform is opened
   * with whatever it will accept prefilled.
   */
  function handoffWithoutSheet(blob: Blob, platform: Platform) {
    downloadBlob(blob);
    flashToast("Image saved — attach it when sharing! 👻");

    if (platform === "whatsapp") {
      /* `shareCaption` already ends with the link. It used to be appended again
         here, which posted the URL twice. */
      window.open(`https://wa.me/?text=${encodeURIComponent(shareCaption)}`, "_blank");
      return;
    }
    if (platform === "x") {
      /* X renders `url` at the end of the tweet itself, so the text it gets is the
         headline alone — the caption would put the link in twice. */
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareHeadline)}&url=${encodeURIComponent(shareDestination)}`,
        "_blank"
      );
      return;
    }

    const deepLinks: Record<string, string> = { instagram: "instagram://story-camera", snapchat: "snapchat://", tiktok: "tiktok://" };
    setTimeout(() => {
      window.location.href = deepLinks[platform];
    }, 500);
  }

  async function handlePlatformShare(platform: Platform) {
    /* Read before anything is awaited. On the warm path this hands the card to
       the share sheet inside the click's own task, which is both why it is
       instant and why the sheet is allowed to open at all — see the pre-warm
       effect. */
    const warm = cachedBlob();

    if (warm && !Capacitor.isNativePlatform()) {
      if (await shareViaSheet(warm)) return;
      /* Sheet refused or cancelled. The image is already in hand, so there is
         nothing to re-render. */
      handoffWithoutSheet(warm, platform);
      return;
    }

    /* Cold: either the pre-warm has not finished — a tap inside the first frame
       or two — or this is the native shell, which writes a file rather than
       handing over a Blob. */
    const blob = warm ?? (await renderBlob());
    if (!blob) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-share-${Date.now()}.jpg`;
          const savedFile = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Documents, recursive: true });
          await Share.share({ title: "Whisper", text: shareCaption, url: savedFile.uri });
        };
        return;
      } catch (err) {
        console.error("Native share error:", err);
      }
    }

    if (await shareViaSheet(blob)) return;

    handoffWithoutSheet(blob, platform);
  }

  const platforms: Platform[] = ["instagram", "snapchat", "whatsapp", "x", "tiktok"];

  if (!host) return null;

  /* ---------------------------------------------------------------------------
     Portalled to <body>, and that is the fix for two bugs that looked unrelated.

     This card is opened from inside `EdgeLitCard` on the dashboard. `.edge-lit`
     sets `isolation: isolate`, which creates a stacking context — so `z-[999]`
     here only ever competed with that card's own children, and the bottom nav's
     `z-50` in the root context painted straight over the modal. That is the "nav
     bar is transparent" report: the nav was not translucent, it was on top.

     And `.edge-lit-inner` sets `backdrop-filter`, which makes it the containing
     block for `position: fixed` descendants. So `inset-0` and `height: 100dvh`
     resolved against a card a few hundred pixels tall instead of the viewport,
     and the bottom of the column — the platform row and the save buttons — fell
     outside the box. That is the "share card is too long" report.

     Raising the z-index cannot fix either one; a z-index cannot escape a stacking
     context, and a containing block is not a paint-order question at all. Moving
     the node out of that subtree fixes both at once, and keeps working wherever
     the card is opened from next.
     --------------------------------------------------------------------------- */
  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex flex-col px-4"
      style={{
        /* Still a dimming scrim — a modal needs one to pull focus — but tinted
           into the palette instead of flat black, so the card reads as glass
           floating over the app rather than a cutout in a black sheet. */
        background: "radial-gradient(120% 90% at 50% 0%, rgba(24,20,64,0.82) 0%, rgba(6,8,24,0.9) 100%)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        /* Over-constrains `inset-0` on purpose, so height wins and `bottom`
           is ignored. A fixed element's 100% resolves against the layout
           viewport, which on mobile Safari is taller than what you can see while
           the URL bar is expanded — that used not to matter when the card was
           simply centred, but now the save button is the last row of a column and
           would sit below the fold. `dvh` tracks the visible height instead. */
        height: "100dvh",
      }}
    >
      <div className="pointer-events-none absolute top-0 left-0 h-96 w-96 rounded-full bg-purple-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-cyan-500/20 blur-[120px]" />

      {/* A flex column rather than a centred block. The story frame is 9:16 and
          has to share a phone screen with the platform row and the save buttons,
          so it takes the leftover height instead of a guessed one. */}
      <div className="relative mx-auto flex h-full w-full max-w-sm flex-col">
        <div className="mb-3 flex shrink-0 justify-end">
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full transition" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(12px)", color: "white" }}>
            <X size={18} />
          </button>
        </div>

        {/* The glass container the frame sits in. Outside the capture tree, so
            this one is free to use a real backdrop blur. */}
        <div
          className="relative flex min-h-0 flex-1 flex-col rounded-[2.25rem] p-3"
          style={{
            background: "linear-gradient(145deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 60%, rgba(168,85,247,0.08) 100%)",
            backdropFilter: "blur(40px) saturate(200%)",
            WebkitBackdropFilter: "blur(40px) saturate(200%)",
            border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {frameWidth > 0 && (
              <StoryFrame
                message={message}
                imageUrl={imageUrl}
                width={frameWidth}
                prompt={prompt}
                accent={accent}
                light={light}
                variant="preview"
              />
            )}
          </div>
        </div>

        {/* The brand row. Each tile now carries the platform's own official mark
            and its real brand colour from SOCIAL_SURFACES, plus a name underneath:
            five unlabelled coloured circles asked the user to identify an app by a
            hand-drawn silhouette, which is a guess they should never have to make.
            The inset rim is what keeps X's and TikTok's pure black from vanishing
            into this panel's dark ground. */}
        <div className="mt-4 flex shrink-0 items-start justify-center gap-2.5">
          {platforms.map((platform) => {
            const surface = SOCIAL_SURFACES[platform];
            return (
              <button
                key={platform}
                onClick={() => handlePlatformShare(platform)}
                disabled={generating}
                aria-label={`Share to ${SOCIAL_LABELS[platform]}`}
                className="group flex w-[3.75rem] flex-col items-center gap-1.5 disabled:opacity-50"
              >
                <span
                  className="grid h-12 w-12 place-items-center rounded-full transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95"
                  style={{
                    background: surface.bg,
                    color: surface.fg,
                    boxShadow:
                      "0 6px 16px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(255,255,255,0.18)",
                  }}
                >
                  <PlatformIcon platform={platform} />
                </span>
                <span
                  className="w-full truncate text-[10px] font-bold leading-none"
                  style={{ color: "rgba(255,255,255,0.62)" }}
                >
                  {SOCIAL_LABELS[platform]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 shrink-0">
          <button onClick={handleDownload} disabled={generating} className="flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
            <Download size={18} /> {generating ? "Generating..." : "Save share card"}
          </button>

          {imageUrl && <button onClick={handleSaveAttachment} disabled={generating} className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}><ImageIcon size={18} /> {generating ? "Processing..." : "Save original photo"}</button>}

          {toast && <div className="mt-2.5 flex w-full items-center justify-center rounded-full px-4 py-2 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.10)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>{toast}</div>}
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          The frame that actually gets rasterized.

          Off-screen rather than restyled, because the preview above and the saved
          file now want different things from the same card: the preview drops the
          black plate and the watermark, the export keeps both. One element cannot
          be both, and toggling it at capture time would flash the plate on screen
          for the length of a 1080x1920 rasterization — and again on every silent
          pre-warm.

          `left: -10000px`, not `display: none` / `visibility: hidden` / zero
          opacity: html2canvas clones the live node and inherits whatever hid it,
          so any of those return an empty bitmap. Moved off-screen it is fully laid
          out and fully painted — its images load and decode, which `getImageBlob`
          waits on — it just isn't anywhere the user can see. html2canvas reads the
          negative offset off `getBoundingClientRect()` and translates its context
          to match, which is exactly what the `x`/`y` defaults are for.

          `aria-hidden` and `pointer-events: none` because this is a duplicate of
          content already on screen: a screen reader must not read the card twice,
          and nothing here is reachable by tab. */}
      {frameWidth > 0 && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: "-10000px",
            pointerEvents: "none",
            zIndex: -1,
          }}
        >
          <StoryFrame
            message={message}
            imageUrl={imageUrl}
            width={frameWidth}
            frameRef={cardRef}
            prompt={prompt}
            accent={accent}
            light={light}
            variant="export"
          />
        </div>
      )}
    </div>,
    host
  );
}
