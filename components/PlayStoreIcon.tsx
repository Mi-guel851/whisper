/**
 * The Google Play store mark, in its real colours.
 *
 * This used to be a single-tint approximation: four triangles painted in
 * `currentColor` at different opacities. That reads as a generic "play" glyph,
 * not as the store — on a download button it looked like a media control, which
 * is the one thing a store button must never look like. The paths below are the
 * official mark, drawn verbatim:
 *
 *   #4285F4  the left chevron    (the edge that closes the shape)
 *   #34A853  the top wedge       (up to the fold)
 *   #EA4335  the bottom wedge
 *   #FBBC04  the right fold      (the ribbon's turn)
 *
 * WHY INLINE SVG RATHER THAN THE BADGE IMAGE
 *
 * The sanctioned "Get it on Google Play" badge is a raster lockup with its own
 * clear-space rules, and it is the right asset when the button *is* the badge.
 * Here the mark sits inside the app's own button — beside the app's own label,
 * on the app's own surface — so it is drawn as vector: crisp at every size and
 * at every device pixel ratio, no extra network request, and nothing that can
 * 404 inside a WebView on a bad connection.
 *
 * COLOUR IS NOT OVERRIDABLE, ON PURPOSE
 *
 * There is no `currentColor` variant: a store mark that inherits the theme's
 * text colour is a broken store mark (and on a white button, an invisible one).
 * `className` is for layout only.
 *
 * The canvas is the mark's own 256:283 — slightly taller than wide, because the
 * ribbon is — so `size` is the rendered HEIGHT and the width follows the aspect
 * ratio. Layouts that align the icon with a line of text want it that way.
 */
export default function PlayStoreIcon({
  className,
  size = 20,
  title,
}: {
  className?: string;
  size?: number;
  /** Accessible name. Omit when the mark sits beside its own written label. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 283"
      width={(size * 256) / 283}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ display: "block", flexShrink: 0 }}
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M1.06 23.487A30.6 30.6 0 0 0 0 31.61v219.327a32.3 32.3 0 0 0 1.06 8.124l122.555-120.966z"
      />
      <path
        fill="#34A853"
        d="m120.436 141.274l61.278-60.483L48.564 4.503A32.85 32.85 0 0 0 32.051 0C17.644-.028 4.978 9.534 1.06 23.399z"
      />
      <path
        fill="#EA4335"
        d="M119.553 134.916L1.06 259.061a32.14 32.14 0 0 0 47.062 19.071l133.327-75.934z"
      />
      <path
        fill="#FBBC04"
        d="M239.37 113.814L181.715 80.79l-64.898 56.95l65.162 64.28l57.216-32.67a31.345 31.345 0 0 0 0-55.537z"
      />
    </svg>
  );
}
