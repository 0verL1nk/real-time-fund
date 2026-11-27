# Cloudflare 边缘行情缓存（/api/quote/\*）

`workers/edge-api.js` 是一个零依赖的 Cloudflare Worker，在边缘为基金行情上游提供同源代理与短时缓存，避免浏览器跨域、客户端重复请求和上游限流。

## 路由

| 路由                                           | 说明                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/quote/health`                        | 健康探针，返回 `{ ok: true, service: "rtf-quote-edge", now }`，`Cache-Control: no-store` |
| `GET /api/quote/valuation?codes=110022,161725` | 天天基金 `FundValuationLast` 批量估值，1~50 个 6 位代码，非法返回 400                    |
| `GET /api/quote/sina?code=110022`              | 新浪 `getEstimateNetworthPic` JSONP 转 JSON，非法代码返回 400                            |
| `OPTIONS /api/*`                               | CORS 预检，204                                                                           |
| 其它路径                                       | 交给 `env.ASSETS` 静态资源（SPA 回退不变）                                               |

## 缓存行为

- 使用 `caches.default`（无 KV），缓存键按排序去重后的代码归一化，同一组代码命中同一条目。
- 新鲜期 10s：直接返回，`X-Edge-Cache: HIT`。
- 陈旧期 10~40s：立即返回旧数据，`X-Edge-Cache: STALE`，同时 `ctx.waitUntil` 后台刷新；同一 isolate 内相同缓存键的刷新会合并。
- 超过 40s 或未命中：同步回源，`X-Edge-Cache: MISS`。
- 回源超时 8s；上游非 2xx 或网络错误返回 502 `{ error: "upstream unavailable" }`，新浪 JSONP 解析失败返回 502 `{ error: "upstream parse failed" }`。

## 部署

```bash
npm run build      # 先生成 ./out 静态资源
npx wrangler deploy
```

`wrangler.jsonc` 中 `assets.directory` 指向 `./out`，`run_worker_first: ["/api/*"]` 让 `/api/*` 先经过 Worker，其余请求仍走静态资源。部署后同源 `/api/quote/*` 自动生效，无需额外配置。

前端会探测 `/api/quote/health`：可用时走同源代理；在 Vercel、GitHub Pages 等没有该路由的纯静态托管上探测失败，同一页面会话内回退直连上游。也可用环境变量 `NEXT_PUBLIC_EDGE_PROXY_URL` 指定外部 Worker 地址（不带末尾斜杠），例如独立部署的 `https://xxx.workers.dev/api/quote`。

> 注意：静态资源来自 `./out`，每次 `wrangler deploy` 前必须先 `npm run build`，否则会发布旧的或缺失的前端产物。
