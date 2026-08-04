"use client";

/**
 * Shimmer placeholders.
 *
 * The shimmer itself is CSS (`.skeleton` in globals.css) so a screen full of
 * these costs one animation, not one per element.
 *
 * Skeletons should mirror the shape of what's loading — same heights, same
 * rhythm. A generic grey box that gets replaced by differently-sized content
 * causes a layout jump and reads worse than a spinner.
 */

type SkeletonProps = {
  className?: string;
  /** Any valid CSS width/height. */
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
};

const roundedMap = {
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
  full: "var(--radius-full)",
};

export function Skeleton({
  className = "",
  width,
  height,
  rounded = "md",
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${className}`}
      style={{ width, height, borderRadius: roundedMap[rounded] }}
    />
  );
}

/** Multi-line text placeholder. The last line is short, like real prose. */
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height="0.7rem"
          width={index === lines - 1 ? "62%" : "100%"}
          rounded="sm"
        />
      ))}
    </span>
  );
}

export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return <Skeleton width={size} height={size} rounded="full" />;
}

/** Matches the inbox/friends row layout: avatar, two text lines, timestamp. */
export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-3 ${className}`}>
      <SkeletonAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <Skeleton height="0.8rem" width="38%" rounded="sm" />
          <Skeleton height="0.6rem" width="2.5rem" rounded="sm" />
        </div>
        <Skeleton className="mt-2" height="0.7rem" width="72%" rounded="sm" />
      </div>
    </div>
  );
}

/** A card-shaped placeholder for grid and list surfaces. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-[1.25rem] p-4 ${className}`}
      style={{
        background: "var(--theme-glass)",
        border: "1px solid var(--theme-glass-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <SkeletonAvatar size={40} />
        <div className="flex-1">
          <Skeleton height="0.75rem" width="45%" rounded="sm" />
          <Skeleton className="mt-2" height="0.6rem" width="30%" rounded="sm" />
        </div>
      </div>
      <SkeletonText className="mt-4" lines={2} />
    </div>
  );
}

export default Skeleton;
