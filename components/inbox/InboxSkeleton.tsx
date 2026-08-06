import GlassPanel from "@/components/GlassPanel";

/**
 * Placeholder chat list, shown while the inbox resolves its session and first
 * query.
 *
 * It replaced a centered `Loading...`, and the reason is perceived speed rather
 * than decoration: the text sat in the middle of an empty screen and then the
 * real list appeared somewhere else, so every visit read as a jump. These rows
 * are laid out at the same 12px avatar / two-line body rhythm as the real
 * `ChatRow`, so the arriving content lands on top of shapes that are already in
 * the right place.
 *
 * No client directive and no props: it renders identically on the server and is
 * pure markup, so it costs nothing to include and can be streamed.
 */
export default function InboxSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <GlassPanel className="overflow-hidden rounded-3xl">
      <ul className="divide-y divide-white/[0.06]" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-center gap-3 px-3 py-3">
            <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {/* Widths alternate so the block reads as a list of different
                    names rather than a stack of identical bars. */}
                <div
                  className="skeleton h-3.5 rounded-full"
                  style={{ width: index % 3 === 0 ? "42%" : index % 3 === 1 ? "34%" : "51%" }}
                />
                <div className="skeleton ml-auto h-2.5 w-10 rounded-full" />
              </div>
              <div
                className="skeleton mt-2 h-3 rounded-full"
                style={{ width: index % 2 === 0 ? "68%" : "56%" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
