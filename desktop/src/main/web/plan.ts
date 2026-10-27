import type { SearchTimeRange } from '../../shared/types';
import { buildChatQuery, buildSearchQuery } from '../search';

/** 检索角度：基础 / 时效 / 对照 / 一手资料。 */
export type SearchAngle = 'base' | 'fresh' | 'compare' | 'primary';

export interface SearchPlanItem {
  query: string;
  angle: SearchAngle;
}

export interface SearchPlanOptions {
  title?: string;
  partTitle?: string;
  owner?: string;
  timeRange?: SearchTimeRange;
  maxQueries?: number;
  scope?: 'chat' | 'summary';
}

const FRESH_HINT = /最新|今年|现在|近期|最近|发布|上市|价格|售价|版本|趋势|今天|current|latest|news/i;
const COMPARE_HINT = /对比|区别|区别|哪个|选哪个|推荐|评测|vs|versus|compare/i;

function normalizeQuery(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * 规则式检索计划：不依赖额外模型调用，保证弱模型也能拿到多角度查询。
 * 第一条永远是主查询，其余角度按需追加，最多 maxQueries 条。
 */
export function buildSearchPlan(question: string, options: SearchPlanOptions = {}): SearchPlanItem[] {
  const maxQueries = Math.max(1, Math.min(4, Number(options.maxQueries) || 3));
  const scope = options.scope === 'summary' ? 'summary' : 'chat';
  if (scope === 'chat' && !String(question || '').trim() && !String(options.title || '').trim()) {
    return [];
  }
  const base =
    scope === 'summary'
      ? buildSearchQuery(options.title || question, options.owner)
      : buildChatQuery(question, { title: options.title, partTitle: options.partTitle });
  const clean = normalizeQuery(base);
  if (!clean) return [];

  const items: SearchPlanItem[] = [{ query: clean, angle: 'base' }];
  const text = `${question} ${options.title || ''}`;
  const hasTimeRange = options.timeRange && options.timeRange !== 'any';

  if (items.length < maxQueries && (FRESH_HINT.test(text) || hasTimeRange || scope === 'summary')) {
    items.push({ query: normalizeQuery(`${clean} 最新进展`), angle: 'fresh' });
  }
  // 对话场景不做“争议/官方文档”这类泛化扩展：它们最容易带进 SEO 垃圾。
  if (items.length < maxQueries && COMPARE_HINT.test(text)) {
    items.push({ query: normalizeQuery(`${clean} 对比 评测`), angle: 'compare' });
  }
  if (items.length < maxQueries && scope === 'summary' && !/价格|多少钱|售价/.test(text)) {
    items.push({ query: normalizeQuery(`${clean} 官方文档 说明`), angle: 'primary' });
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = item.query.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxQueries);
}