/**
 * Cloudflare Worker：基金行情同源边缘缓存代理。
 *
 * 只处理 /api/quote/*：
 * - GET /api/quote/health    健康探针（前端探测同源代理是否可用）
 * - GET /api/quote/valuation 天天基金批量估值（边缘缓存 + stale-while-revalidate）
 * - GET /api/quote/sina      新浪估值 JSONP 转 JSON（边缘缓存）
 * 其余请求交给静态资源（env.ASSETS），保持 SPA 回退。
 */

const FRESH_MS = 10_000; // 10s 内直接命中
const STALE_MS = 30_000; // 10s~40s 先回旧数据，同时后台刷新
const CACHE_LIFETIME_S = (FRESH_MS + STALE_MS) / 1000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_CODES = 50;
const CODE_RE = /^\d{6}$/;
const VALUATION_FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE';

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
};

// 同一 isolate 内避免同一缓存键的并发后台刷新
const inflightRefreshes = new Map();

class UpstreamError extends Error {}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

async function fetchUpstream(url, parse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' }
    });
    if (!res.ok) throw new UpstreamError('upstream unavailable');
    return await parse(res);
  } catch (err) {
    throw err instanceof UpstreamError ? err : new UpstreamError('upstream unavailable');
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(cacheKey) {
  try {
    const hit = await caches.default.match(cacheKey);
    if (!hit) return null;
    const envelope = await hit.json();
    if (!envelope || typeof envelope.storedAt !== 'number' || envelope.body === undefined) return null;
    return envelope;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey, body) {
  const envelope = { storedAt: Date.now(), body };
  try {
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(envelope), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_LIFETIME_S}`
        }
      })
    );
  } catch {
    // 缓存写入失败不影响本次返回
  }
}

function refreshInBackground(ctx, cacheKey, fetcher) {
  const key = cacheKey.url;
  if (inflightRefreshes.has(key)) return;
  const task = (async () => {
    try {
      await writeCache(cacheKey, await fetcher());
    } catch {
      // 刷新失败继续用旧数据，下个请求再试
    } finally {
      inflightRefreshes.delete(key);
    }
  })();
  inflightRefreshes.set(key, task);
  ctx.waitUntil(task);
}

async function serveQuote(ctx, cacheUrl, fetcher) {
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const cached = await readCache(cacheKey);

  if (cached) {
    const age = Date.now() - cached.storedAt;
    if (age < FRESH_MS) {
      return jsonResponse(cached.body, 200, { 'X-Edge-Cache': 'HIT' });
    }
    if (age < FRESH_MS + STALE_MS) {
      refreshInBackground(ctx, cacheKey, fetcher);
      return jsonResponse(cached.body, 200, { 'X-Edge-Cache': 'STALE' });
    }
  }

  try {
    const body = await fetcher();
    await writeCache(cacheKey, body);
    return jsonResponse(body, 200, { 'X-Edge-Cache': 'MISS' });
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : 'upstream unavailable';
    return jsonResponse({ error: message }, 502, { 'X-Edge-Cache': 'MISS' });
  }
}

function parseJsonp(text) {
  const trimmed = text.trim();
  // 新浪不带 callback 时返回纯 JSON；先直接解析，避免正文里出现英文括号时被误截断
  try {
    return JSON.parse(trimmed);
  } catch {
    // 带 callback 的 JSONP：去掉前缀注释与 callback(...) 包裹
    const commentEnd = trimmed.startsWith('/*') ? trimmed.indexOf('*/') : -1;
    const body = commentEnd !== -1 ? trimmed.slice(commentEnd + 2).trim() : trimmed;
    const start = body.indexOf('(');
    const end = body.lastIndexOf(')');
    const payload = start !== -1 && end > start ? body.slice(start + 1, end) : body;
    try {
      return JSON.parse(payload);
    } catch {
      throw new UpstreamError('upstream parse failed');
    }
  }
}

async function handleValuation(url, ctx) {
  const codes = (url.searchParams.get('codes') || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);

  if (codes.length < 1 || codes.length > MAX_CODES || !codes.every((code) => CODE_RE.test(code))) {
    return jsonResponse({ error: 'invalid codes' }, 400);
  }

  const normalized = [...new Set(codes)].sort();
  const upstream = `https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES=${normalized.join(',')}&FIELDS=${VALUATION_FIELDS}`;
  const cacheUrl = `https://edge-cache.internal/valuation?codes=${normalized.join(',')}`;

  return serveQuote(ctx, cacheUrl, () => fetchUpstream(upstream, (res) => res.json()));
}

async function handleSina(url, ctx) {
  const code = (url.searchParams.get('code') || '').trim();
  if (!CODE_RE.test(code)) {
    return jsonResponse({ error: 'invalid code' }, 400);
  }

  const upstream = `https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol=${code}`;
  const cacheUrl = `https://edge-cache.internal/sina?code=${code}`;

  return serveQuote(ctx, cacheUrl, () => fetchUpstream(upstream, async (res) => parseJsonp(await res.text())));
}

const worker = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              ...JSON_HEADERS,
              'Access-Control-Allow-Methods': 'GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Max-Age': '86400'
            }
          });
        }

        if (request.method === 'GET') {
          if (url.pathname === '/api/quote/health') {
            return jsonResponse({ ok: true, service: 'rtf-quote-edge', now: Date.now() }, 200, {
              'Cache-Control': 'no-store'
            });
          }
          if (url.pathname === '/api/quote/valuation') return handleValuation(url, ctx);
          if (url.pathname === '/api/quote/sina') return handleSina(url, ctx);
        } else if (
          url.pathname === '/api/quote/health' ||
          url.pathname === '/api/quote/valuation' ||
          url.pathname === '/api/quote/sina'
        ) {
          return jsonResponse({ error: 'method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
        }
      }

      if (env && env.ASSETS) return env.ASSETS.fetch(request);
      return jsonResponse({ error: 'not found' }, 404);
    } catch {
      return jsonResponse({ error: 'internal error' }, 500);
    }
  }
};

export default worker;
