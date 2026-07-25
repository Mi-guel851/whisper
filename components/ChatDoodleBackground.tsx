"use client";

export default function ChatDoodleBackground() {
  const svgIcons = [
    // Ghost
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4C12.268 4 6 10.268 6 18v14l4-3 4 3 4-3 4 3 4-3 4 3V18C30 10.268 23.732 4 20 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="15" cy="17" r="2" fill="currentColor"/>
      <circle cx="25" cy="17" r="2" fill="currentColor"/>
    </svg>`,
    // Heart
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 34s-14-9-14-19a8 8 0 0116 0 8 8 0 0116 0c0 10-14 19-14 19l-4-3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`,
    // Star
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4l4 12h12l-10 7 4 12-10-7-10 7 4-12L4 16h12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`,
    // Chat bubble
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="32" height="22" rx="6" stroke="currentColor" stroke-width="2"/>
      <path d="M12 28l-6 6V28" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <line x1="12" y1="15" x2="28" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="12" y1="21" x2="22" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    // Sparkle
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4v32M4 20h32M8 8l24 24M32 8L8 32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    // Diamond
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4l16 14-16 18L4 18z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M4 18h32" stroke="currentColor" stroke-width="2"/>
    </svg>`,
    // Moon
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M28 20a12 12 0 01-16-16 14 14 0 1016 16z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`,
    // Butterfly
    `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 20C14 14 4 8 4 16c0 6 8 8 16 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M20 20c6-6 16-12 16-4 0 6-8 8-16 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M20 20C14 26 4 32 4 24c0-6 8-8 16-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M20 20c6 6 16 12 16 4 0-6-8-8-16-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  ];

  const rows = 20;
  const cols = 5;
  const tiles = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const iconIndex = (row * cols + col) % svgIcons.length;
      const staggerX = row % 2 === 0 ? 0 : 10;
      tiles.push({
        svg: svgIcons[iconIndex],
        top: `${(row / rows) * 100}%`,
        left: `${(col / cols) * 100 + staggerX}%`,
        rotate: [-15, 10, -5, 20, -10, 5, -20, 15][( row + col) % 8],
        size: [32, 28, 30, 26, 34][(row + col) % 5],
        opacity: [0.12, 0.09, 0.11, 0.08, 0.13][(row + col) % 5],
      });
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.05),transparent_35%)]" />
      <div className="absolute inset-0 text-white">
        {tiles.map((tile, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              top: tile.top,
              left: tile.left,
              width: tile.size,
              height: tile.size,
              opacity: tile.opacity,
              transform: `rotate(${tile.rotate}deg)`,
            }}
            dangerouslySetInnerHTML={{ __html: tile.svg }}
          />
        ))}
      </div>
    </div>
  );
}