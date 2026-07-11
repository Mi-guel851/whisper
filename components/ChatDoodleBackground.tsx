export default function ChatDoodleBackground() {
  const pattern = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
      <g fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
        <path d="M30 25c0-8 6-14 14-14s14 6 14 14v18l-4-4-4 4-4-4-4 4-4-4-4 4-4-4z" />
        <circle cx="40" cy="20" r="1.6" fill="white" stroke="none" />
        <circle cx="48" cy="20" r="1.6" fill="white" stroke="none" />

        <path d="M150 30h30a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6h-16l-8 8v-8h-6a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6z" />

        <rect x="30" y="120" width="26" height="20" rx="3" />
        <path d="M33 120v-5a10 10 0 0 1 20 0v5" />
        <circle cx="43" cy="130" r="2" fill="white" stroke="none" />

        <path d="M160 130l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z" />

        <path d="M110 170c0-7 5-12 12-12s12 5 12 12v15l-3.5-3.5-3.5 3.5-3.5-3.5-3.5 3.5-3.5-3.5-3.5 3.5z" />
        <circle cx="117" cy="167" r="1.4" fill="white" stroke="none" />
        <circle cx="124" cy="167" r="1.4" fill="white" stroke="none" />

        <path d="M60 70l2 5 5 1-3.5 3.5 1 5-4.5-3-4.5 3 1-5L58 76l5-1z" />
        <path d="M190 90l1.5 3.5 3.5 1-2.5 2.5.5 3.5-3-2-3 2 .5-3.5-2.5-2.5 3.5-1z" />
      </g>
    </svg>
  `.trim();

  const encoded = encodeURIComponent(pattern);

  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.15]"
      style={{
        backgroundImage: `url("data:image/svg+xml,${encoded}")`,
        backgroundRepeat: "repeat",
        backgroundSize: "220px 220px",
      }}
    />
  );
}