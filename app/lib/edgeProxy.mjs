/**
 * 边缘行情代理探测。
 * Cloudflare 部署时同源存在 /api/quote/*（workers/edge-api.js），自动启用；
 * Vercel / GitHub Pages 等纯静态托管没有该路由，探测失败后整页会话内回退直连上游。
 * 也可用 NEXT_PUBLIC_EDGE_PROXY_URL 指定外部 Worker 地址。
 */

const EXPLICIT_BASE = String(process.env.NEXT_PUBLIC_EDGE_PROXY_URL || '')
  .trim()
  .replace(/\/+$/, '');
const SAME_ORIGIN_BASE = '/api/quote';
const PROBE_TIMEOUT_MS = 1500;

let base = null; // null=探测中/未知，''=不可用，其它=可用 base
let probing = null;

function startProbe() {
  if (probing) return probing;
  const candidate = EXPLICIT_BASE || SAME_ORIGIN_BASE;
  probing = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${candidate}/health`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      const type = res.headers.get('content-type') || '';
      const json = res.ok && type.includes('json') ? await res.json() : null;
      base = json?.ok ? candidate : '';
    } catch {
      base = '';
    } finally {
      probing = null;
    }
    return base;
  })();
  return probing;
}

if (typeof window !== 'undefined') startProbe();

/** @returns {string|null} 可用的代理 base（如 /api/quote），未探测完成或不可用时返回 null */
export function getEdgeProxyBase() {
  if (typeof window === 'undefined') return null;
  if (base === null && !probing) startProbe();
  return base || null;
}

/** 代理请求失败时调用，本次会话内不再尝试，避免反复失败拖慢刷新 */
export function markEdgeProxyDown() {
  base = '';
}

/** @returns {string|null} 拼接代理 URL；代理不可用时返回 null */
export function edgeProxyUrl(path, params = {}) {
  const b = getEdgeProxyBase();
  if (!b) return null;
  const url = new URL(`${b}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}
