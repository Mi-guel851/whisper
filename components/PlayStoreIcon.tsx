export default function PlayStoreIcon(props: { className?: string; size?: number }) {
  const s = props.size ?? 18;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden
      className={props.className}
      fill="none"
    >
      {/* Simplified Google Play triangle */}
      <path
        d="M3 3.5L13.2 12 3 20.5V3.5Z"
        fill="currentColor"
        opacity={0.98}
      />
      <path
        d="M3 3.5L13.2 12 16.1 9.4 4.6 2.1C4.1 1.85 3.5 1.9 3 3.5Z"
        fill="currentColor"
        opacity={0.85}
      />
      <path
        d="M3 20.5L16.1 14.6 13.2 12 3 20.5Z"
        fill="currentColor"
        opacity={0.65}
      />
      <path
        d="M16.1 9.4L20.2 7.1C20.9 6.7 21.5 7.2 21.5 8V16C21.5 16.8 20.9 17.3 20.2 16.9L16.1 14.6 13.2 12 16.1 9.4Z"
        fill="currentColor"
        opacity={0.5}
      />
    </svg>
  );
}
