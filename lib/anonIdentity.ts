const ADJECTIVES = [
  "Silent",
  "Hidden",
  "Shadow",
  "Ghost",
  "Midnight",
  "Echo",
  "Masked",
  "Phantom",
  "Dark",
  "Frozen",
  "Lost",
  "Quiet",
];

const NOUNS = [
  "Fox",
  "Wolf",
  "Raven",
  "Tiger",
  "Mist",
  "Wisp",
  "Echo",
  "Ghost",
  "Specter",
  "Falcon",
  "Drift",
  "Storm",
];

export function getAnonIdentity() {
  if (typeof window === "undefined") return "Anonymous";

  const existing = sessionStorage.getItem("whisper_anon");

  if (existing) return existing;

  const adjective =
    ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];

  const noun =
    NOUNS[Math.floor(Math.random() * NOUNS.length)];

  const number = Math.floor(Math.random() * 9000 + 1000);

  const label = `${adjective} ${noun} #${number}`;

  sessionStorage.setItem("whisper_anon", label);

  return label;
}

function hash(str: string) {
  let h = 0;

  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }

  return Math.abs(h);
}

export function getDeterministicAnonLabel(seed: string) {
  const h = hash(seed);

  const adjective = ADJECTIVES[h % ADJECTIVES.length];

  const noun =
    NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];

  const number = (h % 9000) + 1000;

  return `${adjective} ${noun} #${number}`;
}