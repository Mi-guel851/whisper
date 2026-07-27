"use client";

export default function MessageTicks({
  deliveredAt,
  readAt,
}: {
  deliveredAt: string | null;
  readAt: string | null;
}) {
  // 2 blue ticks — message read
  if (readAt) {
    return (
      <span className="inline-flex items-center">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none">
          <path d="M1 5.5L5 9.5L13 1.5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5.5L9 9.5L17 1.5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  // 1 blue tick — message delivered
  if (deliveredAt) {
    return (
      <span className="inline-flex items-center">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none">
          <path d="M1 5.5L5 9.5L13 1.5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5.5L9 9.5L17 1.5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  // 1 grey tick — message sent, not yet delivered
  return (
    <span className="inline-flex items-center">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 5L4 8L9 1.5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}