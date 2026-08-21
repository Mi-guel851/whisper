/**
 * The box a composer's field lives in.
 *
 * This used to own the typing effect itself — a pool of sparks and a caret mirror
 * inside an absolutely-positioned layer over the field. It ran correctly and was
 * almost never visible, because the layer was `inset: 0; overflow: hidden` and
 * the field it wrapped is one line tall. In the chat composer that box is about
 * 44px; the caret sits ~21px down and the burst travels 16–28px *upward*, so
 * every particle crossed the top edge of its own clipping box within a few frames
 * and was cut off. Tuning cannot fix a burst that needs more room than the box
 * has.
 *
 * Emission moved to `components/TypingSparks`, which is mounted once in the root
 * layout and puts its layer at `position: fixed` over the whole viewport, above
 * every modal, where nothing can clip it. That one emitter covers every text
 * field in the app, so there is no second implementation to keep in step and no
 * chance of a field getting two bursts.
 *
 * What is left is the part that was never about sparks: the flex box the two
 * composers size themselves with, and `.explode-host` as a stable styling hook.
 * The name is kept because both call sites and that class refer to it, and
 * because it still marks *which* fields are composers.
 *
 * Not a client component any more — it has no state, no effect and no handlers,
 * so it renders on the server and ships no JavaScript.
 */

type ExplodingInputProps = {
  /** The field itself, plus whatever else shares its box. */
  children: React.ReactNode;
  className?: string;
};

export default function ExplodingInput({
  children,
  className = "",
}: ExplodingInputProps) {
  return <div className={`explode-host ${className}`}>{children}</div>;
}
