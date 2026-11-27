'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNumber, isString } from 'lodash';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchIndexHistory } from '../api/fund';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const BENCHMARKS = [
  { key: 'hs300', secid: '1.000300', name: '沪深300', color: '#f59e0b' },
  { key: 'cyb', secid: '0.399006', name: '创业板指', color: '#a78bfa' }
];
const PORTFOLIO_COLOR = '#22d3ee';
const GRID_COLOR = 'rgba(148, 163, 184, 0.16)';
const TICK_COLOR = '#94a3b8';

function formatRate(value) {
  if (!isNumber(value) || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function rateClass(value) {
  if (!isNumber(value) || !Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'up' : 'down';
}

/**
 * 组合走势：以每日收益记录复利出组合累计收益率，并与沪深300 / 创业板指对比。
 */
export default function PortfolioTrendPanel({ series = [] }) {
  const portfolioSeries = useMemo(() => {
    const rows = (isArray(series) ? series : [])
      .filter(
        (row) =>
          isString(row?.date) &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
          isNumber(row.earnings) &&
          Number.isFinite(row.earnings) &&
          isNumber(row.baseCostAmount) &&
          row.baseCostAmount > 0
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    let compounded = 1;
    const points = [];
    for (const row of rows) {
      compounded *= 1 + row.earnings / row.baseCostAmount;
      points.push({ date: row.date, value: (compounded - 1) * 100 });
    }
    return points;
  }, [series]);

  const startDate = portfolioSeries[0]?.date || '';
  const endDate = portfolioSeries[portfolioSeries.length - 1]?.date || '';

  const { data: benchmarkHistory } = useQuery({
    queryKey: ['portfolioBenchmark', startDate, endDate],
    queryFn: async () => {
      const beg = startDate.replaceAll('-', '');
      const end = endDate.replaceAll('-', '');
      const results = await Promise.all(
        BENCHMARKS.map(async (b) => ({ key: b.key, list: await fetchIndexHistory(b.secid, beg, end) }))
      );
      return results.reduce((acc, item) => ({ ...acc, [item.key]: item.list }), {});
    },
    enabled: portfolioSeries.length >= 2,
    staleTime: 10 * 60 * 1000
  });

  const benchmarkLines = useMemo(() => {
    const history = benchmarkHistory || {};
    const out = {};
    const dates = portfolioSeries.map((p) => p.date);
    for (const b of BENCHMARKS) {
      const list = (isArray(history[b.key]) ? history[b.key] : [])
        .filter((item) => isString(item?.date) && isNumber(item?.close))
        .sort((a, b2) => a.date.localeCompare(b2.date));
      let idx = 0;
      let lastClose = null;
      let baseClose = null;
      out[b.key] = dates.map((date) => {
        while (idx < list.length && list[idx].date <= date) {
          lastClose = list[idx].close;
          idx += 1;
        }
        if (baseClose == null && lastClose != null) baseClose = lastClose;
        return baseClose ? ((lastClose - baseClose) / baseClose) * 100 : null;
      });
    }
    return out;
  }, [benchmarkHistory, portfolioSeries]);

  const latestPortfolio = portfolioSeries[portfolioSeries.length - 1]?.value ?? null;

  if (portfolioSeries.length < 2) {
    return (
      <div className="my-earnings-calendar-card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <p className="text-[14px] font-medium text-[var(--text)]">收益记录不足，暂时无法绘制走势</p>
        <p className="text-[12px] text-[var(--muted)]">至少需要两个交易日的收益记录，系统会在刷新估值后自动累计。</p>
      </div>
    );
  }

  const chartData = {
    labels: portfolioSeries.map((p) => p.date),
    datasets: [
      {
        label: '我的组合',
        data: portfolioSeries.map((p) => p.value),
        borderColor: PORTFOLIO_COLOR,
        backgroundColor: 'rgba(34, 211, 238, 0.12)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: true
      },
      ...BENCHMARKS.map((b) => ({
        label: b.name,
        data: benchmarkLines[b.key] || [],
        borderColor: b.color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.2,
        spanGaps: true
      }))
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: TICK_COLOR, boxWidth: 10, boxHeight: 10, font: { size: 11 } }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}：${formatRate(ctx.parsed.y)}`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: TICK_COLOR, maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } }
      },
      y: {
        grid: { color: GRID_COLOR },
        border: { display: false },
        ticks: {
          color: TICK_COLOR,
          maxTicksLimit: 5,
          font: { size: 10 },
          callback: (value) => `${value}%`
        }
      }
    }
  };

  const summary = [
    { name: '我的组合', value: latestPortfolio, color: PORTFOLIO_COLOR },
    ...BENCHMARKS.map((b) => {
      const line = benchmarkLines[b.key] || [];
      const last = [...line].reverse().find((v) => isNumber(v) && Number.isFinite(v));
      return { name: b.name, value: isNumber(last) ? last : null, color: b.color };
    })
  ];

  return (
    <div className="my-earnings-calendar-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {summary.map((item) => (
          <div key={item.name} className="flex items-baseline gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-[11px] text-[var(--muted)]">{item.name}</span>
            <span className={`text-[13px] font-semibold tabular-nums ${rateClass(item.value)}`}>
              {formatRate(item.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="h-[240px] w-full sm:h-[300px]">
        <Line data={chartData} options={chartOptions} />
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--muted)]">
        组合曲线按每日收益 ÷ 当日成本复利计算，起算于 {startDate}；基准已按同一区间归零，仅作对比参考。
      </p>
    </div>
  );
}
