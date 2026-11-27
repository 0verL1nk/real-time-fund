'use client';

import { useCallback, useEffect, useState } from 'react';
import { nowInTz } from '../lib/fundHelpers';
import { isTradingDay as isDateTradingDay, loadHolidaysForYears } from '../lib/tradingCalendar';
import { getMarketPhase, getEffectiveRefreshMs } from '../lib/marketPhase.mjs';

const computeSnapshot = (refreshMs) => {
  const now = nowInTz();
  const phase = getMarketPhase({
    minutes: now.hour() * 60 + now.minute(),
    isTradingDay: isDateTradingDay(now)
  });
  return { phase, effectiveRefreshMs: getEffectiveRefreshMs(refreshMs, phase.key) };
};

const sameSnapshot = (a, b) =>
  a.phase.key === b.phase.key && a.phase.label === b.phase.label && a.effectiveRefreshMs === b.effectiveRefreshMs;

/**
 * 交易时段感知的刷新间隔：盘中跟随用户设置，盘前/午休/收盘/非交易日自动降频。
 * @param {number} refreshMs 用户设置的刷新间隔
 * @returns {{ phase: { key: string, label: string, isLive: boolean }, effectiveRefreshMs: number }}
 */
export function useMarketPhase(refreshMs) {
  const compute = useCallback(() => computeSnapshot(refreshMs), [refreshMs]);
  const [snapshot, setSnapshot] = useState(compute);

  useEffect(() => {
    const refresh = () => {
      setSnapshot((prev) => {
        const next = compute();
        return sameSnapshot(prev, next) ? prev : next;
      });
    };

    // 节假日数据决定「非交易日」判定，加载完成后立即重算一次
    const year = nowInTz().year();
    loadHolidaysForYears([year, year + 1]).then(refresh);

    const timer = setInterval(refresh, 30 * 1000);
    return () => clearInterval(timer);
  }, [compute]);

  return snapshot;
}
