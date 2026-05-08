// Vercel Edge serverless function — proxies POST queries to the public
// Overpass mirrors and re-emits them with permissive CORS headers.
//
// Why this exists:
//   The browser blocks `fetch('https://overpass-api.de/...')` from our
//   Vercel origin whenever the upstream returns a 5xx or under heavy load
//   the mirror omits `Access-Control-Allow-Origin`. Routing through our
//   own origin sidesteps that entirely (same-origin, no preflight) and
//   also lets us cache responses on Vercel's edge for repeat visitors.
//
// Local dev: Vite proxies `/api/overpass` to the same upstream — see
// `vite.config.ts`.

export const config = {
  runtime: 'edge',
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]

const REQUEST_TIMEOUT_MS = 25_000

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const body = await req.text()
  const contentType = req.headers.get('content-type') || 'text/plain;charset=UTF-8'

  const errors: string[] = []
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!upstream.ok) {
        errors.push(`${endpoint} → ${upstream.status}`)
        continue
      }
      const text = await upstream.text()
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Cache OSM lookups for 10 min on Vercel's edge, and serve
          // stale-while-revalidate for an hour after that. Tile-level
          // changes are infrequent enough that this is more than safe.
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
          ...corsHeaders,
        },
      })
    } catch (err) {
      errors.push(`${endpoint} → ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  return new Response(
    JSON.stringify({
      error: 'All Overpass mirrors failed',
      attempts: errors,
    }),
    {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    },
  )
}
