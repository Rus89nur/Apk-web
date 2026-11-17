/**
 * Cloudflare Worker — прокси DeepSeek Chat Completions.
 * Секрет DEEPSEEK_API_KEY только в env Worker (wrangler secret put).
 * Клиентский бандл ключ не получает.
 */

const ALLOWED_ORIGINS = new Set([
  'https://rus89nur.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateBuckets = new Map();

function corsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://rus89nur.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function clientKey(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function checkRateLimit(key) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

function stripBase64ForLog(value) {
  if (typeof value !== 'string') return value;
  if (value.length > 200 && (value.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 80)))) {
    return `[omitted ${value.length} chars]`;
  }
  return value;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/chat') {
      return jsonResponse({ error: 'Not found' }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    if (!checkRateLimit(clientKey(request))) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429, origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Body too large' }, 413, origin);
    }

    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn('[deepseek-proxy] DEEPSEEK_API_KEY is not set');
      return jsonResponse({ error: 'Proxy misconfigured' }, 500, origin);
    }

    let payload;
    try {
      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Body too large' }, 413, origin);
      }
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) {
      return jsonResponse({ error: 'messages required' }, 400, origin);
    }

    const upstreamBody = {
      model: payload.model || 'deepseek-flash',
      messages: payload.messages,
      stream: false,
    };
    if (payload.response_format) upstreamBody.response_format = payload.response_format;
    if (payload.temperature != null) upstreamBody.temperature = payload.temperature;
    if (payload.max_tokens != null) upstreamBody.max_tokens = payload.max_tokens;
    // Speed: disable thinking / reasoning when client or default asks
    if (payload.thinking != null) upstreamBody.thinking = payload.thinking;
    else upstreamBody.thinking = { type: 'disabled' };
    if (payload.reasoning_effort != null) upstreamBody.reasoning_effort = payload.reasoning_effort;
    else upstreamBody.reasoning_effort = 'none';

    try {
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(upstreamBody),
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        console.warn('[deepseek-proxy] upstream status', upstream.status, stripBase64ForLog(text.slice(0, 200)));
      }

      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      console.warn('[deepseek-proxy] upstream fetch failed', err?.message || 'network');
      return jsonResponse({ error: 'Upstream unavailable' }, 502, origin);
    }
  },
};
