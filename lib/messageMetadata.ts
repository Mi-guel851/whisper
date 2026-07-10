import { NextRequest } from "next/server";

export type SenderMetadata = {
  browser: string | null;
  device_type: string | null;
  operating_system: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  language: string | null;
  metadata_collected_at: string;
};

function parseBrowser(userAgent: string) {
  if (!userAgent) return null;
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/opr\//i.test(userAgent)) return "Opera";
  if (/chrome|crios/i.test(userAgent)) return "Chrome";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  return null;
}

function parseOperatingSystem(userAgent: string) {
  if (!userAgent) return null;
  if (/windows nt/i.test(userAgent)) return "Windows";
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/mac os x|macintosh/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return null;
}

function parseDeviceType(userAgent: string) {
  if (!userAgent) return null;
  if (/ipad|tablet/i.test(userAgent)) return "Tablet";
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

function firstLanguage(acceptLanguage: string | null) {
  return acceptLanguage?.split(",")[0]?.trim() || null;
}

function decodeHeader(value: string | null) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function collectSenderMetadata(request: NextRequest): SenderMetadata {
  const userAgent = request.headers.get("user-agent") || "";

  const geo = (request as NextRequest & { geo?: { country?: string; region?: string; city?: string } }).geo;

  return {
    browser: parseBrowser(userAgent),
    device_type: parseDeviceType(userAgent),
    operating_system: parseOperatingSystem(userAgent),
    country: geo?.country || request.headers.get("x-vercel-ip-country") || null,
    region: geo?.region || request.headers.get("x-vercel-ip-country-region") || null,
    city: geo?.city || decodeHeader(request.headers.get("x-vercel-ip-city")),
    language: firstLanguage(request.headers.get("accept-language")),
    metadata_collected_at: new Date().toISOString(),
  };
}
