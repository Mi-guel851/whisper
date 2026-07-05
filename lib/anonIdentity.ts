const ADJECTIVES = [
  "Silent","Hidden","Quiet","Shadow","Masked","Ghostly","Veiled","Faceless",
  "Whispering","Cloaked","Mystic","Nameless","Phantom","Elusive","Secret",
  "Vanishing","Unseen","Obscure","Muted","Blurred","Foggy","Dim","Wandering",
  "Drifting","Unknown","Enigmatic","Shrouded","Concealed","Fading","Nocturnal",
];

const NOUNS = [
  "Ghost","Phantom","Shade","Wisp","Specter","Wraith","Echo","Mist","Shadow",
  "Whisper","Spirit","Fog","Silhouette","Vapor","Ember","Star","Moon","Raven",
  "Fox","Owl","Wolf","Cat","Sparrow","Lynx","Fern","Willow","Reed","Comet",
];

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getDeterministicAnonLabel(seed: string): string {
  const hash = fnv1aHash(seed);
  const hash2 = fnv1aHash(seed + "::salt2");
  const hash3 = fnv1aHash(seed + "::salt3");

  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[hash2 % NOUNS.length];
  const number = 1000 + (hash3 % 9000);

  return `${adjective} ${noun} #${number}`;
}