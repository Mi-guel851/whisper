/**
 * The chat list's placeholder.
 *
 * Geometry mirrors `ChatRow` exactly — same bleed, same padding, same 72px row —
 * because the point of a skeleton is that nothing moves when the real data lands.
 * When the list was a panel with dividers this was too; it follows the list.
 */
export default function InboxSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <ul className="-mx-4 sm:-mx-6" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3 sm:px-6">
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
  );
}
