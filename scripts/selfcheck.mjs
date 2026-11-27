/**
 * 纯逻辑自检：交易时段/刷新频率策略、估值源健康度。
 * 运行：npm run selfcheck
 */
import assert from 'node:assert/strict';

import { MARKET_PHASE, getEffectiveRefreshMs, getMarketPhase } from '../app/lib/marketPhase.mjs';
import {
  SOURCE_COOLDOWN_MS,
  getSourceHealth,
  isSourceCoolingDown,
  reportSourceFailure,
  reportSourceSuccess,
  resetSourceHealth
} from '../app/lib/sourceHealth.mjs';

const at = (hour, minute, isTradingDay = true) => getMarketPhase({ minutes: hour * 60 + minute, isTradingDay });

// --- 交易时段 ---
assert.equal(at(9, 14).key, MARKET_PHASE.CLOSED);
assert.equal(at(9, 15).key, MARKET_PHASE.PRE);
assert.equal(at(9, 29).key, MARKET_PHASE.PRE);
assert.equal(at(9, 30).key, MARKET_PHASE.OPEN);
assert.equal(at(11, 29).key, MARKET_PHASE.OPEN);
assert.equal(at(11, 30).key, MARKET_PHASE.LUNCH);
assert.equal(at(12, 59).key, MARKET_PHASE.LUNCH);
assert.equal(at(13, 0).key, MARKET_PHASE.OPEN);
assert.equal(at(14, 59).key, MARKET_PHASE.OPEN);
assert.equal(at(15, 0).key, MARKET_PHASE.CLOSED);
assert.equal(at(10, 0, false).key, MARKET_PHASE.NON_TRADING);
assert.equal(at(10, 0, false).isLive, false);
assert.equal(at(10, 0).isLive, true);

// --- 刷新间隔 ---
const BASE = 30_000;
assert.equal(getEffectiveRefreshMs(BASE, MARKET_PHASE.OPEN), BASE);
assert.equal(getEffectiveRefreshMs(BASE, MARKET_PHASE.PRE), 60_000);
assert.equal(getEffectiveRefreshMs(BASE, MARKET_PHASE.LUNCH), 120_000);
assert.equal(getEffectiveRefreshMs(BASE, MARKET_PHASE.CLOSED), 300_000);
assert.equal(getEffectiveRefreshMs(BASE, MARKET_PHASE.NON_TRADING), 1_800_000);
// 用户已设置更长的间隔时不会被缩短
assert.equal(getEffectiveRefreshMs(600_000, MARKET_PHASE.CLOSED), 600_000);
assert.equal(getEffectiveRefreshMs(0, MARKET_PHASE.OPEN), 30_000);

// --- 数据源健康度 ---
resetSourceHealth();
assert.equal(getSourceHealth().degraded, false);
assert.equal(isSourceCoolingDown(1), false);

reportSourceSuccess(1);
assert.equal(getSourceHealth().sources.find((s) => s.id === 1).status, 'ok');

reportSourceFailure(2, new Error('boom'), 1000);
assert.equal(getSourceHealth(1000).sources.find((s) => s.id === 2).status, 'degraded');
assert.equal(isSourceCoolingDown(2, 1000), false);

reportSourceFailure(2, new Error('boom again'), 2000);
assert.equal(getSourceHealth(2000).sources.find((s) => s.id === 2).status, 'down');
assert.equal(isSourceCoolingDown(2, 2000), true);
assert.equal(isSourceCoolingDown(2, 2000 + SOURCE_COOLDOWN_MS + 1), false);

// 成功一次立即恢复
reportSourceSuccess(2, 3000);
assert.equal(isSourceCoolingDown(2, 3000), false);
assert.equal(getSourceHealth(3000).sources.find((s) => s.id === 2).status, 'ok');
assert.equal(getSourceHealth(3000).sources.find((s) => s.id === 2).lastError, null);

resetSourceHealth();
assert.equal(getSourceHealth().degraded, false);

console.log('selfcheck passed: market phase, refresh throttling, source health');
