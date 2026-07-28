"use client";

export default function ChatDoodleBackground() {
  const tileSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
      <g fill="none" stroke="white" stroke-width="2">
        <!-- Ghost -->
        <path opacity="0.45" transform="translate(10,10) rotate(-12) scale(0.8)"
          d="M20 4C12.268 4 6 10.268 6 18v14l4-3 4 3 4-3 4 3 4-3 4 3V18C30 10.268 23.732 4 20 4z"/>
        <circle opacity="0.35" cx="23" cy="21.5" r="1.6" fill="white"/>
        <circle opacity="0.35" cx="33" cy="21.5" r="1.6" fill="white"/>

        <!-- Heart -->
        <path opacity="0.45" transform="translate(150,20) rotate(10) scale(0.8)"
          d="M20 34s-14-9-14-19a8 8 0 0116 0 8 8 0 0116 0c0 10-14 19-14 19l-4-3z"/>

        <!-- Star -->
        <path opacity="0.45" transform="translate(40,120) rotate(-18) scale(0.75)"
          d="M20 4l4 12h12l-10 7 4 12-10-7-10 7 4-12L4 16h12z"/>

        <!-- Chat bubble -->
        <g opacity="0.45" transform="translate(150,130) rotate(8) scale(0.75)">
          <rect x="4" y="6" width="32" height="22" rx="6"/>
          <path d="M12 28l-6 6V28"/>
          <line x1="12" y1="15" x2="28" y2="15" stroke-linecap="round"/>
          <line x1="12" y1="21" x2="22" y2="21" stroke-linecap="round"/>
        </g>

        <!-- Moon -->
        <path opacity="0.45" transform="translate(90,70) rotate(-8) scale(0.7)"
          d="M28 20a12 12 0 01-16-16 14 14 0 1016 16z"/>

        <!-- Diamond -->
        <path opacity="0.45" transform="translate(190,180) rotate(15) scale(0.7)"
          d="M20 4l16 14-16 18L4 18z M4 18h32"/>

        <!-- Sparkle -->
        <path opacity="0.45" transform="translate(10,180) rotate(20) scale(0.65)"
          d="M20 4v32M4 20h32M8 8l24 24M32 8L8 32" stroke-linecap="round"/>

        <!-- Butterfly -->
        <g opacity="0.45" transform="translate(90,190) rotate(-10) scale(0.65)">
          <path d="M20 20C14 14 4 8 4 16c0 6 8 8 16 4" stroke-linecap="round"/>
          <path d="M20 20c6-6 16-12 16-4 0 6-8 8-16 4" stroke-linecap="round"/>
          <path d="M20 20C14 26 4 32 4 24c0-6 8-8 16-4" stroke-linecap="round"/>
          <path d="M20 20c6 6 16 12 16 4 0-6-8-8-16-4" stroke-linecap="round"/>
        </g>
      </g>
    </svg>
  `;

  const encoded = encodeURIComponent(tileSvg.trim());
  const dataUri = `url("data:image/svg+xml,${encoded}")`;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        backgroundImage: dataUri,
        backgroundRepeat: "repeat",
        backgroundSize: "240px 240px",
      }}
    >
      {/* soft radial accents on top of the tiled pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.05),transparent_35%)]" />
    </div>
  );
}