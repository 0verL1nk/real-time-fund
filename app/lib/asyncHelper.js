export async function asyncPool(concurrency, iterable, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of iterable) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

/**
 * 为 Promise 加超时上限；超时后 reject，原 Promise 继续执行（其结果仍会写入各自缓存）。
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {string} [message]
 * @returns {Promise<any>}
 */
export function withTimeout(promise, ms, message = '请求超时') {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 通用异步重试工具
 * @param {Function} fn - 返回 Promise 的异步函数
 * @param {number} [retries=3] - 重试次数
 * @param {number} [delay=1000] - 初始延迟（毫秒）
 * @returns {Promise<any>}
 */
export async function withRetry(fn, retries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // 只有在还有重试机会时才等待
      if (i < retries) {
        const backoff = delay * 2 ** i;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}
