import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type {
  AiTask,
  AppSettings,
  ModelPrice,
  UsageEvent,
  UsageSummary
} from '../../../../shared/types';
import { AI_TASK_LABELS, estimateCost } from '../../../../shared/aiTasks';
import { SettingsSection } from './SettingsSection';
import { askConfirm } from '../ui/confirm';
import {
  activeDayCount,
  cacheHitRate,
  costOfModelRows,
  dailyAverage,
  dateKey,
  dateRangeKeys,
  formatCost,
  formatPercent,
  formatTokens,
  groupUsage,
  longestStreak,
  metricValue,
  peakDay,
  tokensOf,
  topModel,
  type UsageGroupBy,
  type UsageMetric
} from '../../lib/usageStats';

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
  { days: 365, label: '近一年' }
];

const GROUP_OPTIONS: Array<{ id: UsageGroupBy; label: string }> = [
  { id: 'model', label: '按模型' },
  { id: 'platform', label: '按平台' },
  { id: 'task', label: '按任务' }
];

const METRIC_OPTIONS: Array<{ id: UsageMetric; label: string }> = [
  { id: 'tokens', label: 'tokens' },
  { id: 'requests', label: '请求数' },
  { id: 'cost', label: '成本' }
];

const RANGE_STORAGE_KEY = 'bsub.usage.range';

function readStoredRange(): number {
  try {
    const stored = Number(localStorage.getItem(RANGE_STORAGE_KEY));
    if (RANGES.some((range) => range.days === stored)) return stored;
  } catch {
    // ignore
  }
  return 30;
}

function formatTime(value: number): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function formatMetric(value: number, metric: UsageMetric): string {
  if (metric === 'cost') return formatCost(value);
  if (metric === 'requests') return String(Math.round(value));
  return formatTokens(value);
}

interface HeatCell {
  key: string;
  tokens: number;
  requests: number;
  cost: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** 不在当前区间（着色更淡，但仍可点开当天明细）。 */
  outside: boolean;
  /** 今天之后的补位格子，不可点。 */
  future: boolean;
}

/** 热力图始终画一年，方便看长期节奏；当前区间之外的格子淡化。 */
const HEATMAP_DAYS = 365;

/** 近 N 天的日历热力图：按周一到周日排列，空白天补到整周。 */
function buildHeatCells(
  days: number,
  byDay: Array<{ day: string; requests: number; inputTokens: number; outputTokens: number }>,
  dayCost: Map<string, number>,
  metric: 'tokens' | 'cost'
): HeatCell[] {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (HEATMAP_DAYS - 1)
  );
  const rangeStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (days - 1)
  );
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const gridEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  gridEnd.setDate(today.getDate() + (6 - ((today.getDay() + 6) % 7)));

  const map = new Map(byDay.map((row) => [row.day, row]));
  const rangeStartKey = dateKey(rangeStart);
  const todayKey = dateKey(today);
  const keys = dateRangeKeys(gridStart, gridEnd);
  const raw = keys.map((key) => {
    const row = map.get(key);
    return {
      key,
      tokens: row ? row.inputTokens + row.outputTokens : 0,
      requests: row?.requests || 0,
      cost: dayCost.get(key) || 0,
      outside: key < rangeStartKey || key > todayKey,
      future: key > todayKey
    };
  });

  const valueOf = (cell: HeatCell | (typeof raw)[number]) =>
    metric === 'cost' ? cell.cost : cell.tokens;
  const positive = raw
    .filter((cell) => !cell.outside)
    .map((cell) => valueOf(cell))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const threshold = (ratio: number) => {
    if (!positive.length) return 0;
    return positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * ratio))];
  };
  const [q1, q2, q3] = [threshold(0.25), threshold(0.5), threshold(0.75)];
  return raw.map((cell) => {
    const value = valueOf(cell);
    let level: HeatCell['level'] = 0;
    if (value > 0) {
      level = value <= q1 ? 1 : value <= q2 ? 2 : value <= q3 ? 3 : 4;
    }
    return { ...cell, level };
  });
}

interface Props {
  value: AppSettings['usage'];
  onChange: (patch: Partial<AppSettings['usage']>) => void;
}

/** 用量统计：概览、每日热力图、分布分析、分组明细与模型价格。 */
export function UsageSection({ value, onChange }: Props) {
  const [days, setDays] = useState(readStoredRange);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [heatSummary, setHeatSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [heatMetric, setHeatMetric] = useState<'tokens' | 'cost'>('tokens');
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('model');
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (range: number, day: string) => {
    setLoading(true);
    try {
      const [summaryResponse, yearResponse, eventsResponse] = await Promise.all([
        window.bsub.usageSummary(range),
        window.bsub.usageSummary(365),
        window.bsub.usageEvents(day ? 200 : 30, day, range)
      ]);
      if (summaryResponse.ok) setSummary(summaryResponse.data);
      if (yearResponse.ok) setHeatSummary(yearResponse.data);
      if (eventsResponse.ok) setEvents(eventsResponse.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days, selectedDay);
  }, [days, selectedDay, load]);

  const pickRange = (range: number) => {
    setSelectedDay('');
    setDays(range);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, String(range));
    } catch {
      // ignore
    }
  };

  const prices = value.prices || {};
  const totals = summary?.totals;
  const cacheRate = totals ? cacheHitRate(totals) : null;
  const activeDays = summary ? activeDayCount(summary.byDay) : 0;
  const streak = summary ? longestStreak(summary.byDay) : 0;
  const peak = summary ? peakDay(summary.byDay) : null;
  const best = summary ? topModel(summary.byModel) : null;
  const costInfo = useMemo(
    () => (summary ? costOfModelRows(summary.byModel, prices) : { cost: 0, priced: 0, unpriced: 0 }),
    [summary, prices]
  );
  const missingPrice = costInfo.unpriced > 0;

  const dayCost = useMemo(() => {
    const map = new Map<string, number>();
    if (!heatSummary) return map;
    for (const row of heatSummary.byDayModel || []) {
      const cost = estimateCost(row.model, row, prices);
      if (cost !== null) map.set(row.day, (map.get(row.day) || 0) + cost);
    }
    return map;
  }, [heatSummary, prices]);

  const heatCells = useMemo(
    () => buildHeatCells(days, heatSummary?.byDay || [], dayCost, heatMetric),
    [days, heatSummary, dayCost, heatMetric]
  );

  const groups = useMemo(() => {
    if (!summary) return [];
    return [...groupUsage(summary, groupBy, prices)]
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
      .slice(0, 10);
  }, [summary, groupBy, metric, prices]);
  const maxGroup = Math.max(1, ...groups.map((row) => metricValue(row, metric)));

  const modelRows = useMemo(
    () => (summary ? groupUsage(summary, 'model', prices) : []),
    [summary, prices]
  );
  const platformRows = useMemo(
    () => (summary ? groupUsage(summary, 'platform', prices) : []),
    [summary, prices]
  );
  const taskRows = useMemo(
    () => (summary ? groupUsage(summary, 'task', prices) : []),
    [summary, prices]
  );

  const selected = selectedDay
    ? (heatSummary?.byDay || summary?.byDay || []).find((row) => row.day === selectedDay)
    : undefined;
  const toggleDay = (day: string) => {
    setSelectedDay((current) => (current === day ? '' : day));
  };

  const updatePrice = (model: string, patch: Partial<ModelPrice>) => {
    const current: ModelPrice = prices[model] || { input: 0, output: 0 };
    onChange({ prices: { ...prices, [model]: { ...current, ...patch } } });
  };

  return (
    <SettingsSection title="用量统计" defaultOpen>
      <div className="settings-hint">
        每次 AI 请求成功后记录 token 用量；成本按下方价格估算（缓存命中按半价），实际以服务商账单为准。
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled !== false}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        记录用量（关闭后不再写入新记录，已有数据保留）
      </label>

      <div className="usage-toolbar">
        <div className="usage-ranges">
          {RANGES.map((range) => (
            <button
              key={range.days}
              className={`mini-btn ${days === range.days ? 'is-active' : ''}`}
              onClick={() => pickRange(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <div className="usage-actions">
          <button className="mini-btn" onClick={() => void load(days, selectedDay)} title="刷新">
            {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
          <button
            className="mini-btn"
            onClick={async () => {
              const response = await window.bsub.exportUsage();
              if (response.ok && !response.data.canceled) {
                setNotice(`已导出：${response.data.path || ''}`);
              }
            }}
          >
            <Download size={12} />
            导出 CSV
          </button>
          <button
            className="mini-btn"
            onClick={async () => {
              if (!(await askConfirm({ title: '清空所有用量记录？', description: '此操作不可恢复。' }))) return;
              const response = await window.bsub.clearUsage();
              if (response.ok) {
                setNotice(`已清空 ${response.data.removed} 条记录`);
                setSelectedDay('');
                void load(days, '');
              }
            }}
          >
            <Trash2 size={12} />
            清空
          </button>
        </div>
      </div>

      {notice && <div className="settings-hint">{notice}</div>}

      {summary ? (
        <>
          <div className="usage-cards">
            <div className="usage-card">
              <div className="usage-card-label">估算成本</div>
              <div className="usage-card-value">
                {summary.totals.requests && costInfo.priced ? formatCost(costInfo.cost) : '—'}
              </div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">请求数</div>
              <div className="usage-card-value">{summary.totals.requests}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">总 tokens</div>
              <div className="usage-card-value">{formatTokens(tokensOf(summary.totals))}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">缓存命中率</div>
              <div className="usage-card-value">{formatPercent(cacheRate)}</div>
            </div>
          </div>

          {summary.totals.requests > 0 && (
            <div className="usage-insights">
              <div className="usage-insight">
                <div className="usage-card-label">活跃天数</div>
                <div className="usage-insight-value">{activeDays}</div>
                <div className="usage-insight-helper">最长连续 {streak} 天</div>
              </div>
              <div className="usage-insight">
                <div className="usage-card-label">最高单日</div>
                <div className="usage-insight-value">
                  {peak ? formatTokens(tokensOf(peak)) : '—'}
                </div>
                <div className="usage-insight-helper">{peak?.day || '—'}</div>
              </div>
              <div className="usage-insight">
                <div className="usage-card-label">最常用模型</div>
                <div className="usage-insight-value usage-model" title={best?.model || ''}>
                  {best?.model || '—'}
                </div>
                <div className="usage-insight-helper">
                  {best ? `${best.requests} 请求 · ${formatTokens(tokensOf(best))}` : '—'}
                </div>
              </div>
              <div className="usage-insight">
                <div className="usage-card-label">日均 tokens</div>
                <div className="usage-insight-value">
                  {formatTokens(dailyAverage(tokensOf(summary.totals), activeDays))}
                </div>
                <div className="usage-insight-helper">按活跃天数计算</div>
              </div>
            </div>
          )}

          {missingPrice && (
            <div className="settings-hint">
              部分模型还没有价格，成本只统计已配置的模型；可在下方补齐。
            </div>
          )}

          {summary.totals.requests > 0 && (
            <div className="usage-chart">
              <div className="usage-chart-head">
                <span>每日活动（近一年，当前区间高亮）</span>
                <span className="usage-chip-row">
                  <button
                    className={`mini-btn ${heatMetric === 'tokens' ? 'is-active' : ''}`}
                    onClick={() => setHeatMetric('tokens')}
                  >
                    tokens
                  </button>
                  <button
                    className={`mini-btn ${heatMetric === 'cost' ? 'is-active' : ''}`}
                    onClick={() => setHeatMetric('cost')}
                  >
                    成本
                  </button>
                </span>
              </div>
              <div className="usage-heatmap">
                <div className="usage-heat-weekdays" aria-hidden="true">
                  <span>一</span>
                  <span />
                  <span>三</span>
                  <span />
                  <span>五</span>
                  <span />
                  <span>日</span>
                </div>
                <div
                  className="usage-heatmap-grid"
                  role="group"
                  aria-label={`近 ${days} 天每日活动`}
                >
                  {heatCells.map((cell) => (
                    <button
                      key={cell.key}
                      className={`usage-heat-cell level-${cell.level}${
                        cell.key === selectedDay ? ' is-active' : ''
                      }${cell.outside ? ' is-outside' : ''}${cell.future ? ' is-future' : ''}`}
                      title={
                        cell.requests
                          ? `${cell.key} · ${cell.requests} 请求 · ${formatTokens(
                              cell.tokens
                            )} tokens · ${formatCost(cell.cost)}`
                          : `${cell.key} · 无记录`
                      }
                      aria-label={`${cell.key} ${cell.requests} 请求`}
                      tabIndex={cell.requests > 0 ? 0 : -1}
                      onClick={() => {
                        if (!cell.future) toggleDay(cell.key);
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="usage-heat-legend">
                <span>少</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <span key={level} className={`usage-heat-swatch level-${level}`} />
                ))}
                <span>多</span>
                <span className="usage-heat-hint">
                  {heatMetric === 'cost' ? '按每日估算成本着色' : '按每日 token 着色'}
                  {selected ? ` · 已选 ${selectedDay}` : ' · 点格子看当天明细（浅色为区间外）'}
                </span>
              </div>
            </div>
          )}

          {summary.totals.requests > 0 && (
            <div className="usage-chart">
              <div className="usage-chart-head">
                <span>分布分析</span>
                <span className="usage-chip-row">
                  <select
                    className="settings-input usage-select"
                    aria-label="分组方式"
                    value={groupBy}
                    onChange={(event) => setGroupBy(event.target.value as UsageGroupBy)}
                  >
                    {GROUP_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="settings-input usage-select"
                    aria-label="统计指标"
                    value={metric}
                    onChange={(event) => setMetric(event.target.value as UsageMetric)}
                  >
                    {METRIC_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <div className="usage-explore">
                {groups.map((row) => {
                  const value = metricValue(row, metric);
                  const missing = metric === 'cost' && row.cost === null;
                  return (
                    <div key={row.key} className="usage-explore-row">
                      <span className="usage-explore-label" title={row.label}>
                        {row.label}
                      </span>
                      <span className="usage-explore-bar">
                        <span
                          className="usage-explore-fill"
                          style={{
                            width: missing || value <= 0 ? '0%' : `${Math.max(3, (value / maxGroup) * 100)}%`
                          }}
                        />
                      </span>
                      <span className="usage-explore-value">
                        {missing ? '—' : formatMetric(value, metric)}
                      </span>
                    </div>
                  );
                })}
                {!groups.length && <div className="settings-hint">这个区间还没有可统计的请求。</div>}
              </div>
            </div>
          )}

          {modelRows.length > 0 && (
            <>
              <div className="settings-group-title">按模型</div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>缓存</th>
                    <th>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr key={row.key}>
                      <td className="usage-model" title={row.label}>
                        {row.label}
                      </td>
                      <td>{row.requests}</td>
                      <td>{formatTokens(row.inputTokens)}</td>
                      <td>{formatTokens(row.outputTokens)}</td>
                      <td>{formatTokens(row.cacheReadTokens)}</td>
                      <td>{formatCost(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(platformRows.length > 0 || taskRows.length > 0) && (
            <details className="settings-details">
              <summary>按平台 / 按任务</summary>
              {platformRows.length > 0 && (
                <>
                  <div className="settings-group-title">按平台</div>
                  <table className="usage-table">
                    <thead>
                      <tr>
                        <th>平台</th>
                        <th>请求</th>
                        <th>tokens</th>
                        <th>缓存</th>
                        <th>成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformRows.map((row) => (
                        <tr key={row.key}>
                          <td className="usage-model" title={row.label}>
                            {row.label}
                          </td>
                          <td>{row.requests}</td>
                          <td>{formatTokens(tokensOf(row))}</td>
                          <td>{formatTokens(row.cacheReadTokens)}</td>
                          <td>{formatCost(row.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {taskRows.length > 0 && (
                <>
                  <div className="settings-group-title">按任务</div>
                  <table className="usage-table">
                    <thead>
                      <tr>
                        <th>任务</th>
                        <th>请求</th>
                        <th>tokens</th>
                        <th>成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskRows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.requests}</td>
                          <td>{formatTokens(tokensOf(row))}</td>
                          <td>{formatCost(row.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </details>
          )}

          {modelRows.length > 0 && (
            <details className="settings-details">
              <summary>模型价格（每 100 万 token，人民币）</summary>
              <div className="settings-hint">
                留空或 0 表示免费；缓存命中的输入按半价计算。改完即时用于上方成本估算。
              </div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>输入价</th>
                    <th>输出价</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => {
                    const price = prices[row.key] || { input: 0, output: 0 };
                    return (
                      <tr key={`price-${row.key}`}>
                        <td className="usage-model" title={row.key}>
                          {row.label}
                        </td>
                        <td>
                          <input
                            className="settings-input usage-price"
                            type="number"
                            min={0}
                            step={0.1}
                            value={price.input}
                            onChange={(event) =>
                              updatePrice(row.key, { input: Number(event.target.value) || 0 })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="settings-input usage-price"
                            type="number"
                            min={0}
                            step={0.1}
                            value={price.output}
                            onChange={(event) =>
                              updatePrice(row.key, { output: Number(event.target.value) || 0 })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}

          <div className="usage-daybar">
            <span>
              {selectedDay ? `当天明细：${selectedDay}` : '最近请求'}
              {selected ? ` · ${selected.requests} 请求 · ${formatTokens(tokensOf(selected))} tokens` : ''}
            </span>
            {selectedDay && (
              <button className="mini-btn" onClick={() => setSelectedDay('')}>
                清除筛选
              </button>
            )}
          </div>
          {events.length ? (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务</th>
                  <th>平台</th>
                  <th>模型</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>成本</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.createdAt)}</td>
                    <td>{AI_TASK_LABELS[event.task as AiTask] || event.task}</td>
                    <td className="usage-model" title={event.platformName}>
                      {event.platformName || '—'}
                    </td>
                    <td className="usage-model" title={event.model}>
                      {event.model || '—'}
                    </td>
                    <td>{formatTokens(event.inputTokens)}</td>
                    <td>{formatTokens(event.outputTokens)}</td>
                    <td>{formatCost(estimateCost(event.model, event, prices))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="settings-hint">
              {selectedDay
                ? `${selectedDay} 没有请求记录。`
                : '还没有用量记录：发起一次总结或对话后就会出现。'}
            </div>
          )}
        </>
      ) : (
        <div className="settings-hint">
          <Loader2 size={12} className="spin" /> 正在读取用量…
        </div>
      )}

      <div className="settings-hint">
        <BarChart3 size={12} /> 数据只保存在本机 <code>usage.db</code>，不会上传。
      </div>
    </SettingsSection>
  );
}
