export default function WhisperCoinIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="coinRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="coinFace" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a0b33" />
          <stop offset="100%" stopColor="#0a0420" />
        </linearGradient>
        <linearGradient id="ghostBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
        <radialGradient id="coinShine" cx="35%" cy="25%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer rim */}
      <circle cx="32" cy="32" r="31" fill="url(#coinRim)" />

      {/* Inner face */}
      <circle cx="32" cy="32" r="26" fill="url(#coinFace)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

      {/* Ghost body */}
      <path
        d="M32 14c-7.2 0-13 5.8-13 13v14.5c0 .9 1 1.4 1.7.8l2.4-2.1 2.6 2.3c.5.4 1.2.4 1.7 0l2.6-2.3 2.6 2.3c.5.4 1.2.4 1.7 0l2.6-2.3 2.6 2.3c.5.4 1.2.4 1.7 0l2.4-2.1c.7-.6 1.7-.1 1.7.8V27c0-7.2-5.8-13-13-13z"
        fill="url(#ghostBody)"
      />

      {/* Eyes */}
      <circle cx="27" cy="27.5" r="2.4" fill="#0a1a3d" />
      <circle cx="37" cy="27.5" r="2.4" fill="#0a1a3d" />
      <circle cx="27.7" cy="26.6" r="0.7" fill="#ffffff" />
      <circle cx="37.7" cy="26.6" r="0.7" fill="#ffffff" />

      {/* Smile */}
      <path
        d="M29 32.5c.8 1 2 1.6 3 1.6s2.2-.6 3-1.6"
        stroke="#0a1a3d"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Glossy highlight overlay */}
      <circle cx="32" cy="32" r="26" fill="url(#coinShine)" />
    </svg>
  );
}