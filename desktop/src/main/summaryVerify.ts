import type {
  AppSettings,
  PageInfo,
  VerificationSummary,
  VerifiedReference
} from '../shared/types';
import { chatOnce } from './aiClient';
import { platformForTask } from './settings';
import { needsApiKey } from './platformKey';
import { retrieveEvidence } from './web/retrieve';
import { judgeEvidence, type VerifyItem } from './verify';

interface Claim {
  text: string;
  section?: string;
}

function parseJson(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  const candidates = [raw];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // next
    }
  }
  return null;
}

function fallbackClaims(summary: string, limit: number): Claim[] {
  const seen = new Set<string>();
  const claims: Claim[] = [];
  for (const line of String(summary || '').split(/\n+/)) {
    const text = line.replace(/^[#>*\-\s]+/, '').trim();
    if (text.length < 12 || text.length > 200) continue;
    if (!/\d/.test(text) && !/(元|年|月|日|版本|第一|唯一|最大|最早|最晚)/.test(text)) continue;
    const key = text.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ text });
    if (claims.length >= limit) break;
  }
  return claims;
}

async function extractClaims(
  settings: AppSettings,
  info: PageInfo,
  summary: string,
  limit: number,
  signal?: AbortSignal
): Promise<{ claims: Claim[]; total: number }> {
  const platform = platformForTask('verify', settings);
  if (
    !platform ||
    !platform.baseUrl.trim() ||
    (needsApiKey(platform) && !platform.apiKey.trim()) ||
    !platform.model.trim()
  ) {
    const claims = fallbackClaims(summary, limit);
    return { claims, total: claims.length };
  }
  try {
    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content:
            '你是事实核查编辑。只从给定的视频总结里挑出最值得核实的硬事实，不要补全、不要改写事实。'
        },
        {
          role: 'user',
          content: [
            `视频：${info.title || '未知'}`,
            '',
            '从下面这篇总结里挑出可核实的高风险说法，优先：数字/金额/比例、日期/年份、版本号、人名/公司/产品名、「第一/唯一/最大/最早」这类强断言。不要挑观点、预测、主观评价。',
            '尽量覆盖不同章节，避免只挑开头。',
            `最多挑 ${limit} 条；同时估计总结里总共有多少个这类可核实点（total）。`,
            '只输出 JSON，不要 Markdown：',
            '{"claims":[{"text":"总结中的自包含说法（10~80字）","section":"所在章节"}],"total":12}',
            '',
            '总结：',
            String(summary || '').slice(0, 60000)
          ].join('\n')
        }
      ],
      { temperature: 0, maxTokens: 2200, timeoutMs: 120000, task: 'verify', signal }
    );
    const parsed = parseJson(result.text || '') || parseJson(result.reasoning || '');
    const rows = Array.isArray(parsed?.claims) ? parsed?.claims : [];
    const claims: Claim[] = [];
    const seen = new Set<string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const text = String(row?.text || '').trim();
      if (text.length < 6) continue;
      const key = text.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({ text, section: String(row?.section || '').slice(0, 60) });
      if (claims.length >= limit) break;
    }
    if (!claims.length) return { claims: fallbackClaims(summary, limit), total: 0 };
    return {
      claims,
      total: Math.max(claims.length, Number(parsed?.total) || claims.length)
    };
  } catch {
    const claims = fallbackClaims(summary, limit);
    return { claims, total: claims.length };
  }
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceStats(items: VerifyItem[]): {
  singleSource: number;
  multiSource: number;
  conflict: number;
} {
  let singleSource = 0;
  let multiSource = 0;
  let conflict = 0;
  for (const item of items) {
    const refs = item.references || [];
    const supportSites = new Set(
      refs.filter((ref) => ref.verdict === 'support').map((ref) => siteOf(ref.url))
    );
    const refuteSites = new Set(
      refs.filter((ref) => ref.verdict === 'refute').map((ref) => siteOf(ref.url))
    );
    if (supportSites.size && refuteSites.size) conflict += 1;
    else if (supportSites.size >= 2) multiSource += 1;
    else singleSource += 1;
  }
  return { singleSource, multiSource, conflict };
}

export interface SummaryVerifyOptions {
  settings: AppSettings;
  info: PageInfo;
  summary: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

/** 生成后的核对：从总结正文抽硬事实 → 检索 → 判定 → 覆盖率报告。 */
export async function verifySummaryText(
  options: SummaryVerifyOptions
): Promise<VerificationSummary | null> {
  const { settings, info, summary, signal } = options;
  const limit = Math.max(1, Math.min(30, Number(settings.search.verifyItemCount) || 12));
  options.onStatus?.('正在从总结中挑出可核实项…');
  const extracted = await extractClaims(settings, info, summary, limit, signal);
  if (!extracted.claims.length) {
    return {
      items: [],
      references: [],
      supplements: [],
      attempted: 0,
      failed: 0,
      judged: false,
      dropped: 0,
      claimCount: 0,
      singleSource: 0,
      multiSource: 0,
      conflict: 0,
      mode: 'post',
      note: '总结里没有抽到可核实的硬事实'
    };
  }

  const items: VerifyItem[] = new Array(extracted.claims.length);
  let failed = 0;
  let done = 0;
  let next = 0;
  const readPages = Math.max(1, Math.min(5, Number(settings.search.verifyReadPages) || 1));
  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= extracted.claims.length) return;
      const claim = extracted.claims[index];
      try {
        options.onStatus?.(
          `核对总结事实 ${done + 1}/${extracted.claims.length}：${claim.text.slice(0, 24)}`
        );
        const result = await retrieveEvidence(settings, {
          purpose: 'verify',
          queries: [claim.text.replace(/\s+/g, ' ').slice(0, 100)],
          read: readPages,
          maxResults: 6,
          signal
        });
        const refs: VerifiedReference[] = result.evidence.slice(0, 4).map((ref) => ({
          ...ref,
          site: ref.site || siteOf(ref.url)
        }));
        items[index] = {
          label: claim.text,
          query: claim.text,
          line: claim.text,
          context: claim.section,
          references: refs
        };
      } catch {
        if (signal?.aborted) throw new Error('已取消');
        failed += 1;
        items[index] = {
          label: claim.text,
          query: claim.text,
          line: claim.text,
          context: claim.section,
          references: []
        };
      } finally {
        done += 1;
        options.onStatus?.(`核对总结事实 ${done}/${extracted.claims.length}`);
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const allRefs = items.flatMap((item) => item.references || []);
  options.onStatus?.(`已取得 ${allRefs.length} 条证据，正在判定…`);
  const judged = await judgeEvidence(settings, info, items, signal, () => undefined);
  const finalItems = judged?.items || items;
  const refs = finalItems.flatMap((item) => item.references || []);
  const stats = sourceStats(finalItems);
  const platform =
    settings.search.platforms.find((item) => item.id === settings.search.activeId) ||
    settings.search.platforms[0];
  return {
    items: finalItems,
    references: refs,
    sources: refs,
    supplements: judged?.supplements || [],
    attempted: extracted.claims.length,
    failed,
    judged: Boolean(judged) && !judged?.formatError,
    dropped: judged?.dropped || 0,
    claimCount: extracted.total,
    ...stats,
    mode: 'post',
    engine: platform?.name || platform?.kind || '',
    ...(judged?.formatError
      ? { note: '语义判定格式异常，证据已保留但未判定' }
      : {})
  };
}
