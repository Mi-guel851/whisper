const avatarCache = new Map<string, string>();

export function generatedAvatarUrl(userId: string) {
  const cached = avatarCache.get(userId);
  if (cached) return cached;

  const url = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(userId)}`;
  avatarCache.set(userId, url);
  return url;
}
