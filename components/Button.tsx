"use client";

import { forwardRef, useCallback, useState } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

type Variant =
  | "primary"
  | "secondary"
  | "danger"
  | "success"
  | "ghost"
  | "outline";

type Size = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary: "premium-button-primary",
  secondary: "premium-button-secondary",
  danger: "premium-button-danger",
  success: "premium-button-success",
  ghost: "premium-button-ghost",
  outline: "premium-button-outline",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3.5 py-2 text-[0.8125rem] gap-1.5",
  md: "px-5 py-2.5 gap-2",
  lg: "px-7 py-3.5 text-[1rem] gap-2.5",
  icon: "h-10 w-10 p-0",
};

type Ripple = { id: number; x: number; y: number; size: number };

/**
 * Pointer-origin ripple.
 *
 * Shared by Button and ButtonLink — a CTA that navigates should feel identical
 * to one that submits, and duplicating this is how the two drift apart.
 */
function useRipple<T extends HTMLElement>() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const spawn = useCallback((event: MouseEvent<T>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Cover the furthest corner from the click so the ripple always fills.
    const size = Math.hypot(rect.width, rect.height) * 2;
    const id = performance.now();

    setRipples((current) => [
      ...current,
      { id, x: event.clientX - rect.left, y: event.clientY - rect.top, size },
    ]);
    // Matches the 620ms buttonRipple keyframe.
    window.setTimeout(() => {
      setRipples((current) => current.filter((r) => r.id !== id));
    }, 620);
  }, []);

  const nodes = ripples.map((ripple) => (
    <span
      key={ripple.id}
      className="premium-button-ripple"
      style={{
        left: ripple.x,
        top: ripple.y,
        width: ripple.size,
        height: ripple.size,
      }}
    />
  ));

  return { spawn, nodes };
}

function classesFor(
  variant: Variant,
  size: Size,
  fullWidth: boolean,
  className: string
) {
  return `premium-button ${variantClasses[variant]} ${sizeClasses[size]} ${
    fullWidth ? "w-full" : ""
  } ${className}`;
}

/* ------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Rendered before the label; hidden while loading so width stays stable. */
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
};

/**
 * The app's button.
 *
 * Visual treatment lives in `.premium-button*` (globals.css) so it stays
 * theme-aware; this component owns behaviour — the ripple and loading state.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    iconRight,
    fullWidth = false,
    disabled,
    className = "",
    onClick,
    ...props
  },
  ref
) {
  const { spawn, nodes } = useRipple<HTMLButtonElement>();
  const isDisabled = disabled || loading;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      spawn(event);
      onClick?.(event);
    },
    [spawn, onClick]
  );

  return (
    <button
      ref={ref}
      {...props}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={isDisabled ? undefined : handleClick}
      className={classesFor(variant, size, fullWidth, className)}
    >
      {nodes}

      {/* The label stays mounted and keeps its width; only opacity changes.
          Swapping children for a "Loading..." string made buttons jump. */}
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Loader2 size={size === "sm" ? 14 : 17} className="animate-spin" />
        </span>
      )}

      <span
        className={`inline-flex items-center ${loading ? "invisible" : ""}`}
        style={{ gap: "inherit" }}
      >
        {icon}
        {children}
        {iconRight}
      </span>
    </button>
  );
});

export default Button;

/* ------------------------------------------------------------------------- */

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
};

/**
 * A `Link` that looks and presses exactly like a Button.
 *
 * Kept as a separate component rather than a `Button as="a"` prop: navigation
 * and submission have genuinely different attribute sets (`href`/`prefetch` vs
 * `disabled`/`type`/`loading`), and collapsing them produces a props type where
 * half the combinations are invalid.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      href,
      children,
      variant = "primary",
      size = "md",
      icon,
      iconRight,
      fullWidth = false,
      className = "",
      onClick,
      ...props
    },
    ref
  ) {
    const { spawn, nodes } = useRipple<HTMLAnchorElement>();

    return (
      <Link
        ref={ref}
        href={href}
        {...props}
        onClick={(event) => {
          spawn(event);
          onClick?.(event);
        }}
        className={classesFor(variant, size, fullWidth, className)}
      >
        {nodes}
        <span
          className="inline-flex items-center"
          style={{ gap: "inherit" }}
        >
          {icon}
          {children}
          {iconRight}
        </span>
      </Link>
    );
  }
);
