/**
 * 估值数据源健康度登记（内存态）。
 * 连续失败达到阈值后进入冷却期：冷却期内不再作为首选源，但仍可作为并发兜底，
 * 避免每个刷新周期都先打一遍已知故障的源。
 */

export const VALUATION_SOURCE_META = Object.freeze({
  1: { id: 1, name: '天天基金估值' },
  2: { id: 2, name: '新浪估值A' },
  3: { id: 3, name: '新浪估值B' },
  4: { id: 4, name: 'QDII 估值' }
});

export const SOURCE_FAILURE_THRESHOLD = 2;
export const SOURCE_COOLDOWN_MS = 60 * 1000;

const state = new Map();

const createEntry = (id) => ({
  id,
  consecutiveFailures: 0,
  totalFailures: 0,
  totalSuccesses: 0,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  cooldownUntil: 0
});

const getEntry = (id) => {
  const key = Number(id);
  if (!state.has(key)) state.set(key, createEntry(key));
  return state.get(key);
};

export function reportSourceSuccess(id, now = Date.now()) {
  const entry = getEntry(id);
  entry.consecutiveFailures = 0;
  entry.cooldownUntil = 0;
  entry.totalSuccesses += 1;
  entry.lastSuccessAt = now;
  entry.lastError = null;
}

export function reportSourceFailure(id, error, now = Date.now()) {
  const entry = getEntry(id);
  entry.consecutiveFailures += 1;
  entry.totalFailures += 1;
  entry.lastFailureAt = now;
  entry.lastError = error && error.message ? error.message : String(error || '未知错误');
  if (entry.consecutiveFailures >= SOURCE_FAILURE_THRESHOLD) {
    entry.cooldownUntil = now + SOURCE_COOLDOWN_MS;
  }
}

export function isSourceCoolingDown(id, now = Date.now()) {
  const entry = getEntry(id);
  return now < entry.cooldownUntil;
}

export function getSourceHealth(now = Date.now()) {
  const sources = Object.values(VALUATION_SOURCE_META).map((meta) => {
    const entry = getEntry(meta.id);
    const cooling = now < entry.cooldownUntil;
    const status = cooling ? 'down' : entry.consecutiveFailures > 0 ? 'degraded' : 'ok';
    return {
      id: meta.id,
      name: meta.name,
      status,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      cooldownUntil: entry.cooldownUntil
    };
  });
  const downIds = sources.filter((s) => s.status === 'down').map((s) => s.id);
  return {
    sources,
    degraded: sources.some((s) => s.status !== 'ok'),
    downIds
  };
}

export function resetSourceHealth() {
  state.clear();
}
