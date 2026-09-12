/**
 * Double for next/server: the Next.js server runtime has no meaning outside
 * the framework, and the routes use exactly two of its pieces — the request
 * type (plain Request covers it: routes read .text()/.json()/.headers) and
 * NextResponse.json.
 */
export class NextRequest extends Request {}

export const NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  },
};
