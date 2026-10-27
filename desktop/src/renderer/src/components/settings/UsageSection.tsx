import { useEffect, useState } from 'react';
import { BarChart3, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type {
  AiTask,
  AppSettings,
  ModelPrice,
  UsageEvent,
  UsageSummary
} from '../../../../shared/types';
import { AI_TASK_LABELS, estimateCost, priceFor } from '../../../../shared/aiTasks';
import { SettingsSection } from './SettingsSection';
import { askConfirm } from '../ui/confirm';

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
  { days: 365, label: '近一年' }
];

function formatTokens(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatCost(value: number | null): string {
  if (value === null) return '—';
  if (value <= 0) return '¥0';
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  if (value < 1) return `¥${value.toFixed(3)}`;
  return `¥${value.toFixed(2)}`;
}

function formatTime(value: number): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Props {
  value: AppSettings['usage'];
  onChange: (patch: Partial<AppSettings['usage']>) => void;
}

/** 用量统计：按区间汇总 token / 估算成本，可编辑模型价格、导出 CSV。 */
export function UsageSection({ value, onChange }: Props) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async (range: number) => {
    setLoading(true);
    try {
      const [summaryResponse, eventsResponse] = await Promise.all([
        window.bsub.usageSummary(range),
        window.bsub.usageEvents(30)
      ]);
      if (summaryResponse.ok) setSummary(summaryResponse.data);
      if (eventsResponse.ok) setEvents(eventsResponse.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(days);
    // 切换区间时重新汇总；value 变化不需要重查。
  }, [days]);

  const prices = value.prices || {};
  const totalsCost = summary
    ? summary.byModel.reduce((sum, row) => {
        const cost = estimateCost(row.model, row, prices);
        return cost === null ? sum : sum + cost;
      }, 0)
    : 0;
  const missingPrice = Boolean(summary?.byModel.some((row) => !priceFor(row.model, prices)));

  const dayMap = new Map(
    (summary?.byDay || []).map((row) => [
      row.day,
      {
        ...row,
        tokens: row.inputTokens + row.outputTokens
      }
    ])
  );
  const chartDays: Array<{ day: string; label: string; tokens: number; requests: number }> = [];
  const today = new Date();
  for (let offset = Math.min(days, 120) - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    const row = dayMap.get(key);
    chartDays.push({
      day: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens: row?.tokens || 0,
      requests: row?.requests || 0
    });
  }
  const maxDayTokens = Math.max(1, ...chartDays.map((row) => row.tokens));
  const selected = selectedDay ? dayMap.get(selectedDay) : null;

  const updatePrice = (model: string, patch: Partial<ModelPrice>) => {
    const current: ModelPrice = prices[model] || { input: 0, output: 0 };
    onChange({ prices: { ...prices, [model]: { ...current, ...patch } } });
  };

  return (
    <SettingsSection title="用量统计" defaultOpen>
      <div className="settings-hint">
        每次 AI 请求成功后记录 token 用量；成本按下方价格估算，实际以服务商账单为准。
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
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <div className="usage-actions">
          <button className="mini-btn" onClick={() => void load(days)} title="刷新">
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
                void load(days);
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
              <div className="usage-card-label">请求数</div>
              <div className="usage-card-value">{summary.totals.requests}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">输入 tokens</div>
              <div className="usage-card-value">{formatTokens(summary.totals.inputTokens)}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">输出 tokens</div>
              <div className="usage-card-value">{formatTokens(summary.totals.outputTokens)}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-label">估算成本</div>
              <div className="usage-card-value">
                {summary.byModel.length ? formatCost(totalsCost) : '—'}
              </div>
            </div>
          </div>

          {missingPrice && (
            <div className="settings-hint">
              部分模型还没有价格，成本只统计已配置的模型；可在下方补齐。
            </div>
          )}

          <div className="usage-chart">
            <div className="usage-chart-head">
              <span>每日活动</span>
              <span>
                {selected
                  ? `${selected.day} · ${selected.requests} 请求 · ${formatTokens(
                      selected.inputTokens + selected.outputTokens
                    )} tokens`
                  : '点击柱子查看当天'}
              </span>
            </div>
            <div className="usage-bars">
              {chartDays.map((row) => (
                <button
                  key={row.day}
                  className={`usage-bar${selectedDay === row.day ? ' is-active' : ''}`}
                  title={`${row.day} · ${row.requests} 请求 · ${formatTokens(row.tokens)} tokens`}
                  onClick={() => setSelectedDay(row.day)}
                >
                  <span
                    className="usage-bar-fill"
                    style={{
                      height: `${Math.max(3, Math.round((row.tokens / maxDayTokens) * 100))}%`
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="usage-chart-axis">
              <span>{chartDays[0]?.label || ''}</span>
              <span>{chartDays[chartDays.length - 1]?.label || ''}</span>
            </div>
          </div>

          {summary.byModel.length > 0 && (
            <>
              <div className="settings-group-title">按模型</div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((row) => (
                    <tr key={row.model || '(unknown)'}>
                      <td className="usage-model" title={row.model}>
                        {row.model || '(未命名)'}
                      </td>
                      <td>{row.requests}</td>
                      <td>{formatTokens(row.inputTokens)}</td>
                      <td>{formatTokens(row.outputTokens)}</td>
                      <td>{formatCost(estimateCost(row.model, row, prices))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {summary.byTask.length > 0 && (
            <>
              <div className="settings-group-title">按任务</div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>请求</th>
                    <th>输入</th>
                    <th>输出</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byTask.map((row) => (
                    <tr key={row.task}>
                      <td>{AI_TASK_LABELS[row.task as AiTask] || row.task}</td>
                      <td>{row.requests}</td>
                      <td>{formatTokens(row.inputTokens)}</td>
                      <td>{formatTokens(row.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {summary.byModel.length > 0 && (
            <details className="settings-details">
              <summary>模型价格（每 100 万 token，人民币）</summary>
              <div className="settings-hint">留空或 0 表示免费；改完即时用于上方成本估算。</div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>输入价</th>
                    <th>输出价</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((row) => {
                    const price = prices[row.model] || { input: 0, output: 0 };
                    return (
                      <tr key={`price-${row.model}`}>
                        <td className="usage-model" title={row.model}>
                          {row.model || '(未命名)'}
                        </td>
                        <td>
                          <input
                            className="settings-input usage-price"
                            type="number"
                            min={0}
                            step={0.1}
                            value={price.input}
                            onChange={(event) =>
                              updatePrice(row.model, { input: Number(event.target.value) || 0 })
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
                              updatePrice(row.model, { output: Number(event.target.value) || 0 })
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

          <div className="settings-group-title">最近请求</div>
          {events.length ? (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务</th>
                  <th>模型</th>
                  <th>输入</th>
                  <th>输出</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.createdAt)}</td>
                    <td>{AI_TASK_LABELS[event.task] || event.task}</td>
                    <td className="usage-model" title={event.model}>
                      {event.model || '—'}
                    </td>
                    <td>{formatTokens(event.inputTokens)}</td>
                    <td>{formatTokens(event.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="settings-hint">还没有用量记录：发起一次总结或对话后就会出现。</div>
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
