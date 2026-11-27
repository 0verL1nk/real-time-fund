'use client';

import { useEffect, useState } from 'react';
import { RefreshIcon } from './Icons';
import { useModalStore } from '../stores';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const formatInterval = (ms) => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.round(minutes / 60)} 小时`;
};

export default function RefreshButton({
  refreshMs,
  configuredRefreshMs,
  phaseLabel,
  isLive,
  sourceStatus,
  refreshCycleStartRef,
  manualRefresh,
  refreshing,
  fundsLength
}) {
  // 从 Zustand 读取设备冲突弹框状态，暂停刷新进度条；避免 page.jsx 订阅此状态导致全量重渲染
  const deviceConflictModal = useModalStore((s) => s.deviceConflictModal);
  const paused = deviceConflictModal.open;

  // 刷新周期进度 0~1，用于环形进度条
  const [refreshProgress, setRefreshProgress] = useState(0);

  // 刷新进度条：每 100ms 更新一次进度
  useEffect(() => {
    if (fundsLength === 0 || refreshMs <= 0) return;
    const t = setInterval(() => {
      if (paused) return; // 暂停时光条静止
      const elapsed = Date.now() - refreshCycleStartRef.current;
      const p = Math.min(1, elapsed / refreshMs);
      setRefreshProgress(p);
    }, 100);
    return () => clearInterval(t);
  }, [fundsLength, refreshMs, paused, refreshCycleStartRef]);

  const degraded = Boolean(sourceStatus?.degraded);
  const downSources = (sourceStatus?.sources || []).filter((s) => s.status === 'down');
  const throttled = configuredRefreshMs != null && refreshMs > configuredRefreshMs;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`refresh-btn-wrap ${refreshing ? 'is-refreshing' : ''}`}
          style={{ '--progress': refreshing ? 0 : refreshProgress }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="icon-button"
                aria-label={degraded ? '立即刷新（估值源异常，已切换备用源）' : '立即刷新'}
                onClick={manualRefresh}
                disabled={refreshing || fundsLength === 0}
                aria-busy={refreshing}
              >
                <RefreshIcon
                  className={refreshing ? 'spin' : ''}
                  width="18"
                  height="18"
                  style={degraded ? { color: '#f59e0b' } : undefined}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{`立即刷新（${phaseLabel || '刷新'} · 每 ${formatInterval(refreshMs)}）`}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{`${phaseLabel || '刷新周期'} · 每 ${formatInterval(refreshMs)}${isLive ? '实时刷新' : '低频刷新'}`}</p>
        {throttled && <p>{`休市自动降频（已设置 ${formatInterval(configuredRefreshMs)}）`}</p>}
        {degraded && (
          <p>
            {downSources.length
              ? `数据源异常：${downSources.map((s) => s.name).join('、')}，已自动切换备用源`
              : '部分数据源异常，已自动切换备用源'}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
