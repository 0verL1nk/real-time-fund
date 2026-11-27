/**
 * A股交易时段判定与刷新频率策略。
 * 纯函数模块（不依赖 React / dayjs），便于 scripts/selfcheck.mjs 直接校验。
 */

export const MARKET_PHASE = Object.freeze({
  PRE: 'pre',
  OPEN: 'open',
  LUNCH: 'lunch',
  CLOSED: 'closed',
  NON_TRADING: 'non_trading'
});

const PRE_OPEN_START = 9 * 60 + 15; // 09:15
const OPEN_START = 9 * 60 + 30; // 09:30
const MORNING_END = 11 * 60 + 30; // 11:30
const AFTERNOON_START = 13 * 60; // 13:00
const OPEN_END = 15 * 60; // 15:00
const POST_CLOSE_END = 15 * 60 + 30; // 15:30

/**
 * @param {{ minutes: number, isTradingDay: boolean }} input
 *   minutes: 北京时间当天 0-1439
 * @returns {{ key: string, label: string, isLive: boolean }}
 */
export function getMarketPhase({ minutes, isTradingDay }) {
  if (!isTradingDay) return { key: MARKET_PHASE.NON_TRADING, label: '非交易日', isLive: false };
  if (minutes < PRE_OPEN_START) return { key: MARKET_PHASE.CLOSED, label: '未开盘', isLive: false };
  if (minutes < OPEN_START) return { key: MARKET_PHASE.PRE, label: '盘前', isLive: false };
  if (minutes < MORNING_END) return { key: MARKET_PHASE.OPEN, label: '盘中', isLive: true };
  if (minutes < AFTERNOON_START) return { key: MARKET_PHASE.LUNCH, label: '午间休市', isLive: false };
  if (minutes < OPEN_END) return { key: MARKET_PHASE.OPEN, label: '盘中', isLive: true };
  if (minutes < POST_CLOSE_END) return { key: MARKET_PHASE.CLOSED, label: '已收盘', isLive: false };
  return { key: MARKET_PHASE.CLOSED, label: '已收盘', isLive: false };
}

const MINUTE_MS = 60 * 1000;

/**
 * 按交易时段放大刷新间隔：盘中跟随用户设置，休市自动降频，避免无意义的轮询。
 * @param {number} baseMs 用户设置的刷新间隔
 * @param {string} phaseKey getMarketPhase().key
 * @returns {number}
 */
export function getEffectiveRefreshMs(baseMs, phaseKey) {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 30000;
  switch (phaseKey) {
    case MARKET_PHASE.OPEN:
      return base;
    case MARKET_PHASE.PRE:
      return Math.max(base, MINUTE_MS);
    case MARKET_PHASE.LUNCH:
      return Math.max(base, 2 * MINUTE_MS);
    case MARKET_PHASE.CLOSED:
      return Math.max(base, 5 * MINUTE_MS);
    case MARKET_PHASE.NON_TRADING:
      return Math.max(base, 30 * MINUTE_MS);
    default:
      return base;
  }
}
