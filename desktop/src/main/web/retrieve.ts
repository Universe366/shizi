import type { AppSettings } from '../../shared/types';
import { searchWebPlan } from './service';
import type { WebEvidence, WebSearchMeta } from './service';

export type SearchPurpose = 'chat' | 'summary' | 'verify';

interface SearchPolicy {
  maxQueries: number;
  maxResults: number;
  /** 每次检索读取几篇正文；0 = 只用检索结果自带的摘要/正文 */
  read: number;
}

/** 全桌面端统一的联网规则：同一套查询清洗、去重、排序、正文读取与预算。 */
const POLICIES: Record<SearchPurpose, SearchPolicy> = {
  chat: { maxQueries: 3, maxResults: 8, read: 2 },
  summary: { maxQueries: 3, maxResults: 8, read: 2 },
  verify: { maxQueries: 2, maxResults: 6, read: 1 }
};

export interface RetrieveOptions {
  purpose: SearchPurpose;
  queries: string[];
  signal?: AbortSignal;
  maxResults?: number;
  read?: number;
}

export interface RetrieveResult {
  evidence: WebEvidence[];
  meta: WebSearchMeta;
  queries: string[];
}

const EMPTY_META: WebSearchMeta = {
  queries: [],
  engine: '',
  fallback: false,
  cached: false,
  raw: 0,
  deduped: 0,
  fetched: 0,
  elapsedMs: 0,
  failures: []
};

function normalizeQuery(query: string): string {
  return String(query || '')
    .replace(/[“”"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 所有联网入口共用：对话、总结参考资料、联网核对。
 * 差别只在策略里的查询数/结果数/正文篇数，不再各写一套检索与排序。
 */
export async function retrieveEvidence(
  settings: AppSettings,
  options: RetrieveOptions
): Promise<RetrieveResult> {
  const policy = POLICIES[options.purpose];
  const queries = [...new Set(options.queries.map(normalizeQuery).filter(Boolean))].slice(
    0,
    policy.maxQueries
  );
  if (!queries.length) return { evidence: [], meta: { ...EMPTY_META }, queries };
  const result = await searchWebPlan(
    settings,
    queries.map((query) => ({ query, angle: 'base' as const })),
    {
      signal: options.signal,
      maxResults: options.maxResults ?? policy.maxResults,
      read: options.read ?? policy.read
    }
  );
  return { evidence: result.evidence, meta: result.meta, queries };
}
