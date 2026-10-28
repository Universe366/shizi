import type {
  AppSettings,
  PageInfo,
  SubtitleLine,
  VerificationSummary,
  VerifiedReference,
  VerifyVerdict,
  WebReference
} from '../shared/types';
import { platformForTask } from './settings';
import { needsApiKey } from './platformKey';
import { chatOnce } from './aiClient';
import { withSearchSignal } from './search';
import { rankEvidence } from './web';
import { retrieveEvidence } from './web/retrieve';
import { withDeadline } from './async';

const STOPWORDS = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什么',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', 'the', 'and', 'for', 'with', 'this',
  'that', 'from', 'have', 'will', 'your', 'about', 'into', 'than', 'then', 'they',
  'app', 'application', 'pro', 'max', 'plus', 'new', 'never', 'what', 'running', 'door'
]);

type Progress = (done: number, total: number, message: string) => void;

export interface VerifyItem {
  label?: string;
  query: string;
  line: string;
  context?: string;
  references: VerifiedReference[];
}

export type VerifyResult = VerificationSummary;

function clean(value: string): string {
  return String(value || '')
    .replace(/[，。、；：！？“”‘’（）【】《》〈〉·…—～\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasValue(value: string): boolean {
  const term = value.toLowerCase();
  return term.length >= 2 && !STOPWORDS.has(term) && !/^\d+$/.test(term);
}

interface TermScore {
  term: string;
  score: number;
  count: number;
  kind: 'year' | 'number' | 'version' | 'en' | 'cn';
}

function scoreTerms(text: string): Map<string, TermScore> {
  const bag = new Map<string, TermScore>();
  const add = (value: string, kind: TermScore['kind'], weight: number) => {
    const term = clean(value);
    if (!hasValue(term) || term.length > 32) return;
    const previous = bag.get(term);
    if (previous) {
      previous.score += weight;
      previous.count += 1;
    } else {
      bag.set(term, { term, score: weight, count: 1, kind });
    }
  };

  for (const match of text.matchAll(/(19|20)\d{2}\s*年?/g)) add(match[0], 'year', 5);
  for (const match of text.matchAll(
    /\d+(?:\.\d+)?\s*(?:亿|万|千万|百万|千|百|%|％|倍|TB|GB|MB|KB|人|元|美元|次|个)/g
  )) {
    add(match[0], 'number', 5);
  }
  for (const match of text.matchAll(/\b[vV]?\d+(?:\.\d+){1,3}\b/g)) add(match[0], 'version', 4);
  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9+#._-]{2,30}\b/g)) {
    add(match[0], 'en', /[A-Z]/.test(match[0]) || /\d/.test(match[0]) ? 3 : 1.5);
  }
  for (const match of text.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) add(match[0], 'cn', 1);
  return bag;
}

function topTerms(bag: Map<string, TermScore>, limit: number): TermScore[] {
  return [...bag.values()]
    .filter((item) => {
      if (item.kind === 'cn') return item.count >= 2;
      if (item.kind === 'en') {
        // 短的全大写/全小写词只出现一次，多半是语音错字或泛词（DOO/app）。
        if (item.count < 2 && !/\d/.test(item.term)) {
          if (item.term.length <= 3) return false;
          if (/^[A-Z]{2,5}$/.test(item.term)) return false;
          if (/^[a-z]+$/.test(item.term)) return false;
        }
        return item.term.length >= 4 || /\d/.test(item.term);
      }
      return true;
    })
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
    .slice(0, Math.max(0, limit));
}

function extractItems(lines: SubtitleLine[], limit: number): Array<{ term: string; line: string }> {
  const total = Math.max(1, Math.min(20, limit));
  if (!lines.length) return [];
  const segCount = Math.max(1, Math.min(4, Math.ceil(lines.length / 120), total));
  const perSegment = Math.max(1, Math.ceil(total / segCount));
  const size = Math.ceil(lines.length / segCount);
  const picked: Array<{ term: string; line: string }> = [];
  const seen = new Set<string>();

  const take = (bag: Map<string, TermScore>, count: number, from = 0, to = lines.length) => {
    for (const item of topTerms(bag, count)) {
      if (picked.length >= total) return;
      if (seen.has(item.term.toLowerCase())) continue;
      const line = lines
        .slice(from, to)
        .find((candidate) => candidate.text.toLowerCase().includes(item.term.toLowerCase()));
      if (!line) continue;
      seen.add(item.term.toLowerCase());
      picked.push({ term: item.term, line: line.text });
    }
  };

  for (let segment = 0; segment < segCount; segment += 1) {
    const from = segment * size;
    const to = segment === segCount - 1 ? lines.length : Math.min(lines.length, from + size);
    take(scoreTerms(lines.slice(from, to).map((line) => line.text).join('\n')), perSegment, from, to);
  }
  take(scoreTerms(lines.map((line) => line.text).join('\n')), total * 2);
  return picked.slice(0, total);
}

function contextWindowFor(lines: SubtitleLine[], lineText: string, maxChars = 140): string {
  const index = lines.findIndex((line) => line.text === lineText);
  if (index < 0) return clean(lineText).slice(0, maxChars);
  const picked: string[] = [];
  let total = 0;
  const take = (at: number) => {
    const text = clean(lines[at]?.text || '');
    if (!text || total + text.length > maxChars) return;
    picked.push(text);
    total += text.length + 1;
  };
  take(index);
  for (let distance = 1; distance <= 2 && total < maxChars; distance += 1) {
    take(index - distance);
    take(index + distance);
  }
  return picked.join(' ').slice(0, maxChars);
}

function contextualQuery(term: string, context: string): string {
  const value = clean(term);
  const window = clean(context);
  if (!window) return value;
  if (window.length <= 90) return window;
  const index = window.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return `${value} ${window.slice(0, 80)}`.slice(0, 100);
  return window.slice(Math.max(0, index - 30), Math.min(window.length, index + value.length + 45)).trim();
}

const CJK_STOP = new Set([
  '视频', '内容', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '为什',
  '可以', '应该', '如果', '因为', '所以', '但是', '而且', '然后', '现在', '今天',
  '一个', '一些', '非常', '特别', '其实', '就是', '这样', '那样', '大家', '自己',
  '问题', '时候', '地方', '东西', '事情', '情况', '方面', '方式', '方法', '结果',
  '第一', '第二', '第三', '最后', '开始', '结束', '发布', '正式', '目前', '今年',
  '去年', '明年', '最新', '最近', '以及', '还有', '不过', '或者', '因此', '只要',
  '已经', '正在', '表示', '认为', '觉得', '知道', '看到', '进行', '出现', '发生',
  '成为', '作为', '通过', '根据', '关于', '对于', '由于', '同时', '此外', '例如',
  '比如', '包括', '主要', '重要', '可能', '需要', '提供', '支持', '使用', '实现'
]);

function normalizeMatch(value: string): string {
  return String(value || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(query: string): { strong: string[]; cjk: string[] } {
  const text = normalizeMatch(query);
  const strong: string[] = [];
  const cjk: string[] = [];
  for (const match of text.matchAll(/[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g)) {
    const segment = match[0];
    if (/^[a-z0-9]/.test(segment)) {
      if (segment.length >= 2 && !STOPWORDS.has(segment) && !strong.includes(segment)) {
        strong.push(segment);
      }
      continue;
    }
    for (let index = 0; index + 1 < segment.length; index += 1) {
      const bigram = segment.slice(index, index + 2);
      if (!CJK_STOP.has(bigram) && !cjk.includes(bigram)) cjk.push(bigram);
    }
  }
  return { strong, cjk };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

function evidenceText(reference: WebReference): string {
  return clean(`${reference.title} ${reference.snippet}`);
}

function trimQuote(text: unknown): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** 判定 quote 是否逐字落在证据里：忽略标点、空白、大小写和全半角差异。 */
function normalizeQuoteText(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function quoteMatches(quote: string, text: string): boolean {
  const normalizedQuote = normalizeQuoteText(quote);
  const normalizedText = normalizeQuoteText(text);
  return normalizedQuote.length >= 4 && normalizedText.includes(normalizedQuote);
}

export function parseJudgeJson(text: string): Record<string, unknown> | unknown[] | null {
  const raw = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  if (!raw) return null;
  const candidates = [raw];
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']']
  ] as const) {
    const first = raw.indexOf(open);
    const last = raw.lastIndexOf(close);
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  }
  const parsedCandidates: Array<Record<string, unknown> | unknown[]> = [];
  for (const candidate of candidates) {
    // 模型偶尔会留尾逗号；去掉后再试一次，不要因为一个逗号整次核对失败。
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object') {
          parsedCandidates.push(parsed as Record<string, unknown> | unknown[]);
          break;
        }
      } catch {
        // 试下一个候选
      }
    }
  }
  if (!parsedCandidates.length) return null;
  const judgeKeys = ['judgments', 'verdicts', 'items', 'data', 'supplements'];
  const objectWithJudgeKeys = parsedCandidates.find(
    (parsed) => !Array.isArray(parsed) && judgeKeys.some((key) => key in parsed)
  );
  if (objectWithJudgeKeys) return objectWithJudgeKeys;
  const array = parsedCandidates.find((parsed) => Array.isArray(parsed));
  if (array) return array;
  return parsedCandidates[0];
}

interface EvidenceRow {
  id: string;
  itemIndex: number;
  refIndex: number;
  item: VerifyItem;
  reference: WebReference;
}

async function judgeEvidence(
  settings: AppSettings,
  info: PageInfo,
  items: VerifyItem[],
  signal: AbortSignal | undefined,
  _onProgress: Progress
): Promise<{
  items: VerifyItem[];
  supplements: string[];
  dropped: number;
  formatError?: boolean;
} | null> {
  const platform = platformForTask('verify', settings);
  if (!platform || !platform.baseUrl.trim() || (needsApiKey(platform) && !platform.apiKey.trim()) || !platform.model.trim()) {
    return null;
  }

  const evidence: EvidenceRow[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    for (let refIndex = 0; refIndex < items[itemIndex].references.length; refIndex += 1) {
      evidence.push({
        id: `E${evidence.length + 1}`,
        itemIndex,
        refIndex,
        item: items[itemIndex],
        reference: items[itemIndex].references[refIndex]
      });
    }
  }
  if (!evidence.length) return null;

  const prompt = [
    `视频标题：${info.title || '未知'}`,
    '',
    '请逐条判断下面的检索证据是否真的能支持或反驳字幕里的待核实项。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释：',
    '{"judgments":[{"id":"E1","verdict":"support|refute|irrelevant","quote":"证据原文中的连续片段"}],"supplements":["基于证据的简短补充"]}',
    '',
    '规则：',
    '- quote 必须逐字摘自对应证据的标题或摘要，4~60 字；找不到就判 irrelevant。',
    '- support：证据明确支持字幕说法；refute：证据明确矛盾；irrelevant：只是同名/同领域，没谈字幕里的那件事。',
    '- 不要因为出现同一个产品名就判 support。',
    '- 先确认证据与字幕说的是同一实体、同一时间范围、同一单位；只是同领域或同名不同事就判 irrelevant。',
    '- supplements 最多 3 条，每条不超过 120 字，只能写证据确实补充/纠正的内容；没有就返回空数组。',
    '',
    ...evidence.map(
      (row) =>
        `${row.id} | 待核实项：${row.item.label || row.item.query} | 字幕：${row.item.line.slice(0, 70)} | ` +
        `标题：${row.reference.title} | 证据：${row.reference.snippet.slice(0, 600)}`
    )
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('证据判定超时')), 120000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const system = '你是严格的事实核查员，只依据给定证据判断，不补脑、不猜。';
    const result = await chatOnce(
      platform,
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      { temperature: 0, maxTokens: 5000, signal: controller.signal, timeoutMs: 120000, task: 'verify' }
    );
    // 部分推理模型只把 JSON 放在 reasoning 里，content 为空或只有一句解释；
    // 两边分别解析，不要用 `text || reasoning` 让解释文字顶掉真正的 JSON。
    let parsed = parseJudgeJson(result.text || '') ?? parseJudgeJson(result.reasoning || '');
    if (!parsed) {
      // 与插件一致：再用紧凑的 claim/evidence 格式重试一次。
      // 很多模型在长 ID（E1/E2）格式上会写成说明文，换短格式就能稳定出 JSON。
      console.warn('[verify] 判定不是 JSON，改用紧凑格式重试');
      const compact = [
        '你是事实核对助手。下面每条是视频字幕里的一句话，以及检索到的网页证据。',
        'verdict 只能是 support / refute / irrelevant；support/refute 的 quote 必须从证据里逐字摘 4~50 字。',
        '只输出 JSON，不要解释、不要 Markdown 代码块：',
        '{"verdicts":[{"claim":1,"evidence":1,"verdict":"support","quote":"证据里的原文"}]}',
        ...evidence.map(
          (row) =>
            `[句 ${row.itemIndex + 1}] ${String(row.item.line || '').slice(0, 180)}\n` +
            `  证据 ${row.itemIndex + 1}-${row.refIndex + 1}：${String(row.reference.title || '').slice(0, 120)}｜${String(row.reference.snippet || '').slice(0, 320)}`
        )
      ].join('\n');
      const retry = await chatOnce(
        platform,
        [
          { role: 'system', content: system },
          { role: 'user', content: compact }
        ],
        { temperature: 0.1, maxTokens: 2500, signal: controller.signal, timeoutMs: 120000, task: 'verify' }
      );
      parsed = parseJudgeJson(retry.text || '') ?? parseJudgeJson(retry.reasoning || '');
      if (!parsed) {
        console.warn(
          '[verify] 紧凑格式仍不是 JSON：',
          String(retry.text || retry.reasoning || '').slice(0, 300)
        );
      }
    }
    if (!parsed) {
      // 判定只是“锦上添花”：格式不对就保留全部证据、标记未判定，
      // 不要整次核对报错（用户会以为联网/Key 坏了）。
      console.warn('[verify] 语义判定不是 JSON，保留证据并标记未判定');
      return { items, supplements: [], dropped: 0, formatError: true };
    }

    const evidenceById = new Map(evidence.map((row) => [row.id, row]));
    const evidenceByIndex = new Map(
      evidence.map((row) => [`${row.itemIndex}:${row.refIndex}`, row])
    );
    const drop = new Set<string>();
    const verdicts = new Map<string, VerifyVerdict>();
    const alias: Record<string, VerifyVerdict> = {
      支持: 'support',
      反驳: 'refute',
      矛盾: 'refute',
      无关: 'irrelevant',
      不相关: 'irrelevant'
    };
    const rawRows = Array.isArray(parsed)
      ? parsed
      : (parsed.judgments ?? parsed.verdicts ?? parsed.items ?? parsed.data ?? []);
    let valid = 0;
    for (const rawRow of Array.isArray(rawRows) ? rawRows : []) {
      const judgment = (rawRow || {}) as Record<string, unknown>;
      let row: EvidenceRow | undefined;
      if (judgment.id) {
        row = evidenceById.get(String(judgment.id));
      } else if (judgment.claim != null && judgment.evidence != null) {
        row = evidenceByIndex.get(
          `${Number(judgment.claim) - 1}:${Number(judgment.evidence) - 1}`
        );
      }
      if (!row) continue;
      const rawVerdict = String(judgment.verdict || '').toLowerCase();
      const verdict = alias[rawVerdict] || rawVerdict;
      if (verdict === 'irrelevant') {
        drop.add(row.id);
        continue;
      }
      if (verdict !== 'support' && verdict !== 'refute') continue;
      const quote = trimQuote(judgment.quote);
      // 标点/空白不参与比对；对不上只降级为 unknown，不把证据整条丢掉。
      if (!quoteMatches(quote, evidenceText(row.reference))) continue;
      verdicts.set(row.id, verdict);
      valid += 1;
    }
    if (!valid && !drop.size) return null;

    const kept = items.map((item, itemIndex) => ({
      ...item,
      references: item.references.flatMap((reference, refIndex) => {
        const row = evidence.find(
          (candidate) => candidate.itemIndex === itemIndex && candidate.refIndex === refIndex
        );
        if (row && drop.has(row.id)) return [];
        const verdict = row ? verdicts.get(row.id) : undefined;
        return [verdict ? { ...reference, verdict } : reference];
      })
    }));

    const supplements = (
      Array.isArray(parsed)
        ? []
        : Array.isArray(parsed.supplements)
          ? parsed.supplements
          : []
    )
      .map((value: unknown) => clean(String(value || '')))
      .filter((value: string) => value.length >= 8 && value.length <= 180)
      .slice(0, 3);
    return { items: kept, supplements, dropped: drop.size };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

function sampleSubtitleText(lines: SubtitleLine[], maxChars = 3600): string {
  if (!lines.length) return '';
  const per = Math.ceil(maxChars / 3);
  const take = (rows: SubtitleLine[]) =>
    rows
      .map((line) => String(line.text || ''))
      .join('\n')
      .slice(0, per);
  const third = Math.max(1, Math.floor(lines.length / 3));
  return [
    take(lines.slice(0, third)),
    take(lines.slice(third, third * 2)),
    take(lines.slice(third * 2))
  ]
    .filter(Boolean)
    .join('\n…\n');
}

export function parseSearchQueries(text: string, max = 6): string[] {
  const raw = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  if (!raw) return [];
  let rows: unknown[] = [];
  const parseCandidate = (candidate: string): boolean => {
    try {
      const json = JSON.parse(candidate);
      if (Array.isArray(json)) {
        rows = json;
        return true;
      }
      if (json && Array.isArray(json.queries)) {
        rows = json.queries;
        return true;
      }
    } catch {
      // 继续尝试
    }
    return false;
  };
  if (!parseCandidate(raw)) {
    // 模型偶尔会在 JSON 前后加一句解释；取出最外层的数组/对象再试。
    const arrayStart = raw.indexOf('[');
    const arrayEnd = raw.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) parseCandidate(raw.slice(arrayStart, arrayEnd + 1));
    if (!rows.length) {
      const objectStart = raw.indexOf('{');
      const objectEnd = raw.lastIndexOf('}');
      if (objectStart >= 0 && objectEnd > objectStart) {
        parseCandidate(raw.slice(objectStart, objectEnd + 1));
      }
    }
  }
  if (!rows.length) rows = raw.split(/\n+/);
  const out: string[] = [];
  for (const item of rows) {
    if (typeof item !== 'string') continue;
    const query = item
      .replace(/^\s*(?:[-*•·]+\s*|\(\d{1,2}\)\s*|\d{1,2}[.、)）]\s*)/u, '')
      .replace(/^["“”']+|["“”']+$/gu, '')
      .trim();
    if (query.length < 3 || query.length > 100) continue;
    if (/https?:\/\//i.test(query) || /^(无|没有|无法|none|null)$/i.test(query)) continue;
    if (out.some((existing) => existing.toLowerCase() === query.toLowerCase())) continue;
    out.push(query);
    if (out.length >= max) break;
  }
  return out;
}

function findContextForQuery(lines: SubtitleLine[], query: string, maxChars = 140): string {
  if (!lines.length) return '';
  const { strong, cjk } = queryTokens(query);
  const probes = [...new Set([...strong, ...cjk])];
  if (!probes.length) return '';
  let best = -1;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const hay = normalizeMatch(line.text);
    let score = 0;
    for (const probe of probes) {
      if (probe && hay.includes(probe)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  if (best < 0) return '';
  const picked: Array<{ index: number; text: string }> = [];
  let total = 0;
  const take = (index: number) => {
    if (index < 0 || index >= lines.length) return;
    if (picked.some((item) => item.index === index)) return;
    const text = clean(lines[index].text);
    if (!text || total + text.length > maxChars) return;
    picked.push({ index, text });
    total += text.length + 1;
  };
  take(best);
  for (let distance = 1; distance <= 3 && total < maxChars; distance += 1) {
    take(best - distance);
    take(best + distance);
  }
  picked.sort((a, b) => a.index - b.index);
  return picked.map((item) => item.text).join(' ').slice(0, maxChars);
}

function isQueryGroundedIn(query: string, source: string): boolean {
  const text = normalizeMatch(source);
  if (!text) return false;
  const { strong, cjk } = queryTokens(query);
  if (strong.some((term) => text.includes(term))) return true;
  return cjk.some((bigram) => bigram.length === 2 && text.includes(bigram));
}

async function buildAiQueries(
  settings: AppSettings,
  info: PageInfo,
  lines: SubtitleLine[],
  limit: number,
  signal?: AbortSignal
): Promise<VerifyItem[]> {
  const platform = platformForTask('verify', settings);
  const sample = sampleSubtitleText(lines);
  if (!sample || !platform || !platform.baseUrl.trim() || (needsApiKey(platform) && !platform.apiKey.trim())) return [];

  // 先把全文里「实体 + 具体说法」抽出来，连同原句交给模型，避免它只看节选就编查询。
  const candidates = extractItems(lines, 16);
  const candidateBlock = candidates.length
    ? `全文里值得核实的候选（可直接改写，不要另编）：\n${candidates
        .map((item) => {
          const context = contextWindowFor(lines, item.line);
          return `- ${item.term}：${clean(context || item.line).slice(0, 100)}`;
        })
        .join('\n')}`
    : '';

  const system = [
    '你是检索词生成助手。根据视频标题、字幕节选与候选句，生成 1~4 条适合外部事实验证的搜索查询。',
    '要求：',
    '0. 只处理可外部验证的硬信息（数字 / 时间 / 版本 / 事件 / 人物身份 / 产品参数）。',
    '   故事、观点、情绪、教程步骤、主观评价都不要生成查询；如果整段视频没有这类硬信息，直接输出 []，不要为了凑数而搜。',
    '1. 每条查询都要还原字幕里的一个具体说法：实体 + 要核实的限定（时间 / 数字 / 版本 / 因果），',
    '   例如「DeepSeek V4 2026 年 3 月发布」「DeepSeek V4 6710 亿参数」；',
    '2. 不要只输出实体名（「DeepSeek」），也不要写行业空话（「AI 行业趋势」「最新进展」）；',
    '3. 实体必须在视频里真实出现过，不要编造视频没提过的公司 / 产品 / 人物，也不要把两个视频外的概念拼在一起；',
    '4. 每条 8~30 字，不要解释，不要编号；',
    '5. 优先基于下面给出的候选句来写，保留候选里的实体与具体说法；',
    '6. 只输出 JSON 字符串数组，例如 ["DeepSeek V4 发布时间", "6710 亿参数量"]。'
  ].join('\n');
  const user = [
    `视频标题：${info.title || ''}${info.partTitle ? ` · ${info.partTitle}` : ''}`,
    `字幕节选：\n${sample}`,
    candidateBlock
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = await chatOnce(
      platform,
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, maxTokens: 400, timeoutMs: 60000, signal, task: 'verify' }
    );
    const parsed = parseSearchQueries(result.text || result.reasoning || '', 6);
    if (!parsed.length) {
      console.warn('[verify] AI 检索词生成返回空/无法解析');
      return [];
    }
    const source = [
      info.title || '',
      info.partTitle || '',
      lines.map((line) => line.text).join('\n')
    ]
      .filter(Boolean)
      .join('\n');
    const out: VerifyItem[] = [];
    const seen = new Set<string>();
    for (const query of parsed) {
      if (!isQueryGroundedIn(query, source)) continue;
      const context = findContextForQuery(lines, query);
      const searchQuery = contextualQuery(query, context);
      const key = searchQuery.replace(/\s+/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: query, query: searchQuery, line: context, context, references: [] });
      if (out.length >= Math.max(1, Math.min(limit, 6))) break;
    }
    console.log('[verify] AI queries', parsed.length, 'grounded', out.length);
    return out;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    console.warn('[verify] AI 检索词生成失败', (error as Error)?.message || String(error));
    return [];
  }
}

export async function verifySummary(
  settings: AppSettings,
  info: PageInfo,
  lines: SubtitleLine[],
  signal: AbortSignal | undefined,
  onProgress: Progress
): Promise<VerifyResult> {
  const limit = Math.max(1, Math.min(20, Number(settings.search.verifyItemCount) || 8));

  // 优先让 AI 从字幕里挑「实体 + 具体说法」生成检索词；关闭或失败时退回规则抽取。
  let items: VerifyItem[] = [];
  if (settings.search.aiQueryGeneration !== false) {
    onProgress(0, limit, 'AI 正在挑选待核实项…');
    items = await buildAiQueries(settings, info, lines, Math.min(limit, 6), signal);
    if (!items.length) onProgress(0, limit, 'AI 检索词不可用，改用规则抽取');
  }
  if (!items.length) {
    items = extractItems(lines, limit).map((item) => {
      const context = contextWindowFor(lines, item.line);
      return {
        label: item.term,
        query: contextualQuery(item.term, context),
        line: item.line,
        context,
        references: []
      };
    });
  }

  // 用户额外指定的核实查询：原话作为检索词，同时补上字幕里对应的原句做相关性过滤。
  const extraQueries = String(settings.search.extraVerifyQueries || '')
    .split(/\n+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3 && value.length <= 100);
  if (extraQueries.length) {
    const used = new Set(
      items.map((item) => (item.label || item.query).replace(/\s+/g, '').toLowerCase())
    );
    for (const query of extraQueries) {
      if (items.length >= limit) break;
      const key = query.replace(/\s+/g, '').toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      const context = findContextForQuery(lines, query);
      items.push({ label: query, query, line: context, context, references: [] });
    }
  }

  if (!items.length) {
    return {
      items: [],
      references: [],
      supplements: [],
      attempted: 0,
      failed: 0,
      judged: false,
      dropped: 0
    };
  }

  let done = 0;
  let failed = 0;
  // 网络往返是大头：3 路并发放到 12 条核对上，耗时约为串行的三分之一。
  const results = await mapLimit(items, 3, async (item) => {
    if (signal?.aborted) throw new Error('已终止');
    const line = clean(item.line);
    const index = line.toLowerCase().indexOf(item.query.toLowerCase());
    const context =
      index >= 0
        ? line.slice(Math.max(0, index - 8), Math.min(line.length, index + item.query.length + 8))
        : '';
    const searchQuery = /^[0-9]|年|次|%|％/.test(item.query) && context
      ? `${item.query} ${context}`.slice(0, 48)
      : item.query;
    const label = item.label || item.query;
    let raw: WebReference[] | null = null;
    // 与对话/总结共用同一套联网规则（查询清洗、排序、正文读取、预算）。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const searchAbort = new AbortController();
      const forwardAbort = () => searchAbort.abort(signal?.reason);
      signal?.addEventListener('abort', forwardAbort, { once: true });
      if (signal?.aborted) searchAbort.abort();
      try {
        // 单个核对项最多等 15 秒；超时/取消都会真正中止底层 HTTP。
        raw = await withDeadline(
          withSearchSignal(searchAbort.signal, async () => {
            const result = await retrieveEvidence(settings, {
              purpose: 'verify',
              queries: [searchQuery],
              read: Math.max(1, Math.min(3, settings.search.verifyReadPages || 1)),
              signal: searchAbort.signal
            });
            return result.evidence;
          }),
          15000,
          signal,
          '检索超时',
          () => searchAbort.abort(new Error('检索超时'))
        );
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        const timedOut = (error as Error)?.name === 'TimeoutError';
        if (attempt === 1 || timedOut) {
          failed += 1;
          done += 1;
          onProgress(done, items.length, label);
          return { ...item, references: [] as WebReference[] };
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      } finally {
        signal?.removeEventListener('abort', forwardAbort);
      }
    }
    if (!raw) {
      failed += 1;
      done += 1;
      onProgress(done, items.length, label);
      return { ...item, references: [] as WebReference[] };
    }
    let refs = raw;
    const pickReferences = (query: string) =>
      rankEvidence(refs, [query])
        .slice(0, 4)
        .map((reference) => ({ ...reference, site: reference.site || siteOf(reference.url) }));
    let ranked = pickReferences(searchQuery);
    if (!ranked.length) {
      // 原查询太窄（引号、年份、长尾修饰）时，用去掉年份/引号的简化词再试一次。
      const simplified = searchQuery
        .replace(/[“”"'‘’]/g, ' ')
        .replace(/\b(19|20)\d{2}\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (simplified && simplified !== searchQuery && simplified.length >= 4) {
        ranked = pickReferences(simplified);
        if (!ranked.length) {
          // 同一批结果里没有可用的，再真正搜一次简化词，而不是直接判「无证据」。
          const retryAbort = new AbortController();
          const forwardRetry = () => retryAbort.abort(signal?.reason);
          signal?.addEventListener('abort', forwardRetry, { once: true });
          try {
            const more = await withDeadline(
              withSearchSignal(retryAbort.signal, async () => {
                const result = await retrieveEvidence(settings, {
                  purpose: 'verify',
                  queries: [simplified],
                  read: Math.max(1, Math.min(3, settings.search.verifyReadPages || 1)),
                  signal: retryAbort.signal
                });
                return result.evidence;
              }),
              12000,
              signal,
              '检索超时',
              () => retryAbort.abort(new Error('检索超时'))
            );
            if (more.length) {
              refs = [...refs, ...more];
              ranked = pickReferences(simplified);
            }
          } catch {
            // 简化词二次检索失败就保留空结果
          } finally {
            signal?.removeEventListener('abort', forwardRetry);
          }
        }
      }
    }
    done += 1;
    onProgress(done, items.length, label);
    return { ...item, references: ranked };
  });

  let finalItems: VerifyItem[] = results;
  let supplements: string[] = [];
  let judged = false;
  let dropped = 0;
  let judgeError = '';
  let judgeNote = '';
  try {
    onProgress(items.length, items.length, '语义判定证据…');
    const verdict = await judgeEvidence(settings, info, results, signal, onProgress);
    if (verdict) {
      finalItems = verdict.items;
      supplements = verdict.supplements;
      dropped = verdict.dropped;
      judged = !verdict.formatError;
      if (verdict.formatError) {
        judgeNote = '模型没有按 JSON 返回判定结果，已保留检索证据；可换个模型重新生成，或在设置里关闭「总结前联网核对」。';
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    judgeError = (error as Error)?.message || String(error);
    console.warn('[verify] 语义判定失败', judgeError);
    // 判定失败时保留已搜到的证据，不让总结直接失去联网结果。
  }

  finalItems = annotateConsistency(finalItems);

  // 语义判定失败时，至少让模型从证据里整理出 0~3 条可用补充，
  // 避免把一堆未判定的网页原样塞进总结（那样最容易显得“怪”）。
  if (!judged) {
    try {
      supplements = await buildSupplements(settings, info, finalItems, signal);
    } catch {
      // 补充整理失败不影响总结
    }
  }

  const byUrl = new Map<string, WebReference>();
  for (const item of finalItems) {
    for (const reference of item.references) {
      if (!byUrl.has(reference.url)) byUrl.set(reference.url, reference);
    }
  }

  return {
    items: finalItems,
    references: [...byUrl.values()].slice(0, 10),
    supplements,
    attempted: items.length,
    failed,
    judged,
    dropped,
    error: judgeError || undefined,
    note: judgeNote || undefined
  };
}

function siteOf(url: string): string {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.');
    if (parts.length <= 2) return parts.join('.');
    // 常见二级后缀（co.uk / com.cn 等）保留三段
    const last2 = parts.slice(-2).join('.');
    if (/^(co|com|net|org|gov|edu)\.(uk|cn|jp|hk|tw|au)$/.test(last2)) {
      return parts.slice(-3).join('.');
    }
    return last2;
  } catch {
    return '';
  }
}

function annotateConsistency(items: VerifyItem[]): VerifyItem[] {
  return items.map((item) => {
    const support = new Set<string>();
    const refute = new Set<string>();
    let sawVerdict = false;
    const references = item.references.map((reference) => {
      const site = reference.site || siteOf(reference.url);
      if (reference.verdict === 'support') {
        sawVerdict = true;
        if (site) support.add(site);
      } else if (reference.verdict === 'refute') {
        sawVerdict = true;
        if (site) refute.add(site);
      }
      return { ...reference, site };
    });
    if (!sawVerdict) return { ...item, references };
    const distinct = new Set([...support, ...refute]).size;
    const consistency: 'multi' | 'single' | 'conflict' =
      support.size > 0 && refute.size > 0 ? 'conflict' : distinct >= 2 ? 'multi' : 'single';
    return {
      ...item,
      references: references.map((reference) => ({ ...reference, consistency }))
    };
  });
}

async function buildSupplements(
  settings: AppSettings,
  info: PageInfo,
  items: VerifyItem[],
  signal?: AbortSignal
): Promise<string[]> {
  const platform = platformForTask('verify', settings);
  if (!platform || !platform.baseUrl.trim() || (needsApiKey(platform) && !platform.apiKey.trim())) return [];
  const rows: string[] = [];
  for (const item of items) {
    for (const reference of item.references) {
      if (rows.length >= 18) break;
      rows.push(
        `- ${item.label || item.query}｜字幕：${item.line.slice(0, 60)}｜证据：${reference.title.slice(
          0,
          60
        )}｜${reference.snippet.replace(/\s+/g, ' ').slice(0, 400)}`
      );
    }
  }
  if (!rows.length) return [];

  const result = await chatOnce(
    platform,
    [
      {
        role: 'system',
        content:
          '你是视频笔记的核对助手。只依据给出的检索证据，输出 0~3 条「外部补充」。' +
          '每条一句话（不超过 80 字），必须是证据直接支持、且能补充或纠正视频里具体数字/时间/事实的内容；' +
          '与视频无关、只是同名、无法确认的不要写。不要写来源、网址、编号或「根据资料」之类的词。' +
          '只输出 JSON：{"supplements":["..."]}，没有就返回空数组。'
      },
      {
        role: 'user',
        content: `视频标题：${info.title || '未知'}\n\n${rows.join('\n')}`
      }
    ],
    { temperature: 0.1, maxTokens: 500, signal, timeoutMs: 60000, task: 'verify' }
  );

  const text = String(result.text || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      const list = Array.isArray(parsed?.supplements) ? parsed.supplements : [];
      return list
        .map((item: unknown) => clean(String(item || '')))
        .filter((item: string) => item.length >= 8 && item.length <= 180 && !/https?:\/\//i.test(item))
        .slice(0, 3);
    } catch {
      // 继续按行解析
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => clean(line.replace(/^[-*•·\d.、)）\s]+/, '')))
    .filter((line) => line.length >= 8 && line.length <= 180 && !/https?:\/\//i.test(line))
    .slice(0, 3);
}

export function buildVerifyBlock(result: VerifyResult): string {
  // 未完成语义判定：只给整理好的外部补充，不把未判定的网页列表塞进总结。
  if (!result.judged) {
    if (!result.supplements.length) return '';
    return [
      '',
      '【外部补充（可选参考）】',
      '只在确实能补充视频内容时自然融入；不要改写字幕里的事实性陈述。',
      '不要单独列出来源，不要写「检索到 / 根据资料 / 待核实」，不要输出网址或编号。',
      ...result.supplements.map((item) => `- ${item}`),
      '',
      '写作要求：',
      '- 字幕与补充冲突时，保留字幕原说法，另用「外部资料称…」提示差异；不要直接改字幕里的数字/时间/术语。',
      '- 与视频无关就忽略，不要为了“用上检索”而硬加内容。'
    ].join('\n');
  }

  const rows: string[] = [];

  for (const item of result.items) {
    const usable = item.references.filter(
      (reference) => reference.verdict === 'support' || reference.verdict === 'refute'
    );
    if (!usable.length) continue;
    const label = item.label || item.query;
    const evidence = usable
      .slice(0, 3)
      .map((reference) => {
        let site = '';
        try {
          site = new URL(reference.url).hostname.replace(/^www\./i, '');
        } catch {
          site = '';
        }
        const verdict = reference.verdict === 'support' ? '支持' : '反驳';
        const consistency =
          reference.consistency === 'multi'
            ? '；多源一致'
            : reference.consistency === 'conflict'
              ? '；来源冲突'
              : '';
        return `${reference.title.slice(0, 60)}（${site || '来源'}；${verdict}${consistency}）：${reference.snippet
          .replace(/\s+/g, ' ')
          .slice(0, 180)}`;
      })
      .join('；');
    rows.push(`- ${label}（字幕原句：${item.line.slice(0, 80)}）→ ${evidence}`);
  }

  if (!rows.length && !result.supplements.length) return '';
  return [
    '',
    ...(result.supplements.length
      ? [
          '【外部补充（可选参考）】',
          '下面是外部资料里与视频相关、且相对明确的补充或提醒。只在确实能补充或纠正视频内容时自然融入；',
          '不要单独列出来源，不要写「检索到 / 根据资料 / 待核实」，不要输出网址或编号；与正文无关就忽略。',
          ...result.supplements.map((item) => `- ${item}`),
          ''
        ]
      : []),
    '【待核实项与证据（只用于补充或提示差异，不要照抄，不要列来源）】',
    ...rows,
    '',
    '写作要求：',
    '- 不要改写字幕里的事实性陈述；证据与字幕冲突时，保留字幕原说法，另用「外部资料称…」提示差异。',
    '- 只在确实补充了视频内容时自然融入；不要输出网址、编号或「根据检索」之类的话。',
    '- 证据与视频无关时忽略，不要为了“用上检索”而硬加内容。'
  ].join('\n');
}
