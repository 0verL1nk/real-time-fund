'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNumber, isString } from 'lodash';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { fetchFundHoldings } from '../api/fund';
import { mergeAllHoldings } from '../lib/dailyEarnings';
import { useStorageStore } from '../stores';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn, formatMoney } from '@/lib/utils';
import { CloseIcon } from './Icons';

const UNCLASSIFIED = '未分类';

function formatPercent(value) {
  if (!isNumber(value) || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function parseWeight(weight) {
  const num = parseFloat(String(weight ?? '').replace('%', ''));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * 持仓穿透：汇总全部持仓基金最近披露的前十大重仓股，
 * 估算个股与行业层面的实际暴露，暴露重复重仓与集中度风险。
 */
export default function PortfolioPenetrationPage({ open, onOpenChange, masked = false }) {
  const isMobile = useIsMobile();
  const funds = useStorageStore((s) => s.funds);
  const holdings = useStorageStore((s) => s.holdings);
  const groupHoldings = useStorageStore((s) => s.groupHoldings);
  const [tab, setTab] = useState('stock');

  const fundByCode = useMemo(() => new Map((isArray(funds) ? funds : []).map((f) => [f.code, f])), [funds]);

  // 全部作用域合并后的持仓（全局 + 各分组）
  const stakes = useMemo(() => {
    const merged = mergeAllHoldings(holdings, groupHoldings);
    return Object.entries(merged)
      .map(([code, holding]) => {
        const fund = fundByCode.get(code);
        const nav = Number(fund?.dwjz) || Number(fund?.gsz) || 0;
        const share = Number(holding?.share) || 0;
        const amount = share * nav;
        return {
          code,
          name: fund?.name || code,
          amount
        };
      })
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [holdings, groupHoldings, fundByCode]);

  const codesKey = stakes
    .map((s) => s.code)
    .sort()
    .join(',');

  const { data: fundHoldingsList, isPending } = useQuery({
    queryKey: ['portfolioPenetration', codesKey],
    queryFn: async () =>
      Promise.all(
        stakes.map(async (stake) => {
          try {
            const res = await fetchFundHoldings(stake.code);
            return {
              code: stake.code,
              holdings: isArray(res?.holdings) ? res.holdings : [],
              reportDate: res?.holdingsReportDate || ''
            };
          } catch (e) {
            return { code: stake.code, holdings: [], reportDate: '' };
          }
        })
      ),
    enabled: open && stakes.length > 0,
    staleTime: 60 * 60 * 1000
  });

  const analysis = useMemo(() => {
    const list = isArray(fundHoldingsList) ? fundHoldingsList : [];
    const stakeByCode = new Map(stakes.map((s) => [s.code, s]));
    const stockMap = new Map();
    const industryMap = new Map();
    let totalAsset = 0;
    let coveredAmount = 0;
    let latestReportDate = '';

    for (const item of list) {
      const stake = stakeByCode.get(item.code);
      if (!stake) continue;
      totalAsset += stake.amount;
      if (item.reportDate && item.reportDate > latestReportDate) latestReportDate = item.reportDate;
      for (const h of item.holdings || []) {
        const weight = parseWeight(h.weight);
        if (!weight) continue;
        const exposure = stake.amount * (weight / 100);
        coveredAmount += exposure;
        const stockKey = h.code || h.name;
        if (!stockKey) continue;

        const prevStock = stockMap.get(stockKey) || {
          key: stockKey,
          code: h.code || '',
          name: h.name || h.code || '',
          industry: h.industry || UNCLASSIFIED,
          amount: 0,
          funds: new Map()
        };
        prevStock.amount += exposure;
        prevStock.funds.set(stake.code, stake.name);
        stockMap.set(stockKey, prevStock);

        const industry = h.industry || UNCLASSIFIED;
        const prevIndustry = industryMap.get(industry) || { name: industry, amount: 0, stocks: new Set() };
        prevIndustry.amount += exposure;
        prevIndustry.stocks.add(stockKey);
        industryMap.set(industry, prevIndustry);
      }
    }

    const stocks = [...stockMap.values()]
      .map((s) => ({ ...s, fundCount: s.funds.size }))
      .sort((a, b) => b.amount - a.amount);
    const industries = [...industryMap.values()]
      .map((i) => ({ ...i, stockCount: i.stocks.size }))
      .sort((a, b) => b.amount - a.amount);
    const top1Amount = stocks[0]?.amount || 0;
    const top3IndustryAmount = industries.slice(0, 3).reduce((sum, i) => sum + i.amount, 0);

    return {
      totalAsset,
      latestReportDate,
      stocks,
      industries,
      topStockName: stocks[0]?.name || '',
      coverage: totalAsset > 0 ? (coveredAmount / totalAsset) * 100 : 0,
      top1Share: totalAsset > 0 ? (top1Amount / totalAsset) * 100 : 0,
      top3IndustryShare: totalAsset > 0 ? (top3IndustryAmount / totalAsset) * 100 : 0,
      duplicateCount: stocks.filter((s) => s.fundCount >= 2).length
    };
  }, [fundHoldingsList, stakes]);

  const renderRow = (item, index, type) => {
    const share = analysis.totalAsset > 0 ? (item.amount / analysis.totalAsset) * 100 : 0;
    const title = item.name;
    const subtitle =
      type === 'stock' ? [item.code, item.industry].filter(Boolean).join(' · ') : `${item.stockCount} 只重仓股`;
    const badge = type === 'stock' && item.fundCount >= 2 ? `${item.fundCount} 只基金共同重仓` : null;

    return (
      <div key={type === 'stock' ? item.key : item.name} className="flex flex-col gap-1.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-[11px] text-[var(--muted)] tabular-nums">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-[var(--text)]">{title}</span>
              {badge && (
                <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                  {badge}
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-[var(--muted)]">{subtitle}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[13px] font-semibold tabular-nums text-[var(--text)]">
              {masked ? '***' : `¥${formatMoney(item.amount)}`}
            </div>
            <div className="text-[11px] tabular-nums text-[var(--muted)]">{formatPercent(share)}</div>
          </div>
        </div>
        <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--muted-foreground)_12%,transparent)]">
          <div
            className={cn('h-full rounded-full', type === 'stock' ? 'bg-[var(--primary)]' : 'bg-[#a78bfa]')}
            style={{ width: `${Math.max(share, item.amount > 0 ? 1 : 0)}%`, opacity: 0.75 }}
          />
        </div>
      </div>
    );
  };

  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      {stakes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <span className="text-2xl" aria-hidden="true">
            🧭
          </span>
          <p className="text-[14px] font-medium text-[var(--text)]">暂无持仓可穿透</p>
          <p className="text-[12px] text-[var(--muted)]">请先在首页添加基金并维护持仓金额。</p>
        </div>
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4 sm:px-6">
            {[
              {
                label: '穿透覆盖资产',
                value: isPending ? '…' : formatPercent(analysis.coverage),
                hint: '前十大重仓股覆盖度'
              },
              {
                label: '第一大重仓股',
                value: isPending ? '…' : formatPercent(analysis.top1Share),
                hint: analysis.topStockName || '占全部持仓资产'
              },
              {
                label: '前3大行业',
                value: isPending ? '…' : formatPercent(analysis.top3IndustryShare),
                hint: '占全部持仓资产'
              },
              {
                label: '重复重仓股',
                value: isPending ? '…' : `${analysis.duplicateCount} 只`,
                hint: '被 2 只以上基金共同持有'
              }
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_60%,transparent)] px-3 py-2"
              >
                <div className="text-[11px] text-[var(--muted)]">{stat.label}</div>
                <div className="text-[16px] font-semibold tabular-nums text-[var(--text)]">{stat.value}</div>
                <div className="text-[10px] text-[var(--muted)]">{stat.hint}</div>
              </div>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 sm:px-6">
            {[
              { id: 'stock', label: '个股穿透' },
              { id: 'industry', label: '行业暴露' }
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                  tab === t.id
                    ? 'bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] font-medium text-[var(--primary)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                )}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            {isPending && <span className="text-[11px] text-[var(--muted)]">正在汇总重仓数据…</span>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
            {tab === 'stock'
              ? analysis.stocks.map((item, index) => renderRow(item, index, 'stock'))
              : analysis.industries.map((item, index) => renderRow(item, index, 'industry'))}
            {!isPending && analysis.stocks.length === 0 && (
              <div className="py-10 text-center text-[12px] text-[var(--muted)]">
                暂未获取到重仓股披露数据，请稍后重试。
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--border)] px-4 py-2.5 text-[10px] leading-relaxed text-[var(--muted)] sm:px-6">
            重仓股口径：各基金最近披露的前十大股票（{analysis.latestReportDate || '报告期未知'}），按「占净值比 ×
            当前持仓金额」估算，非实时持仓；未披露部分不计入。
          </div>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={!!open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="flex flex-shrink-0 flex-row items-center justify-between gap-2 space-y-0 px-5 pb-3 pt-2 text-left">
            <DrawerTitle className="text-base font-semibold text-[var(--text)]">持仓穿透</DrawerTitle>
            <DrawerClose
              className="icon-button border-none bg-transparent p-1"
              style={{ borderColor: 'transparent', backgroundColor: 'transparent' }}
            >
              <CloseIcon width="20" height="20" />
            </DrawerClose>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={!!open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[88vh] w-[min(720px,calc(100vw-24px))] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex flex-shrink-0 flex-row items-center justify-between gap-2 space-y-0 px-6 pb-3 pt-5 text-left">
          <DialogTitle className="text-base font-semibold text-[var(--text)]">持仓穿透</DialogTitle>
          <DialogClose
            className="icon-button border-none bg-transparent p-1"
            style={{ borderColor: 'transparent', backgroundColor: 'transparent' }}
          >
            <CloseIcon width="20" height="20" />
          </DialogClose>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
