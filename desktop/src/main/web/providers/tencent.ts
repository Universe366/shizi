import { createHash, createHmac } from 'node:crypto';
import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { keyOf, timeoutFetch } from './shared';

/**
 * 腾讯云「元宝搜索」（Web Search API，服务名 wsa）。
 *
 * 接口：POST https://wsa.tencentcloudapi.com，Action=SearchPro，Version=2025-05-08。
 * 鉴权走腾讯云 API v3 签名（TC3-HMAC-SHA256），所以 Key 需要 SecretId 与 SecretKey 两段。
 */
const SERVICE = 'wsa';
const VERSION = '2025-05-08';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** Key 统一填「SecretId:SecretKey」；也允许用空白分隔。 */
export function parseTencentSecret(raw: string): { secretId: string; secretKey: string } {
  const text = String(raw || '').trim();
  const match = /^([^:\s]+)[:\s]+(\S+)$/.exec(text);
  if (!match) {
    throw new Error('腾讯云搜索的 Key 需要填「SecretId:SecretKey」（访问管理 → API 密钥）');
  }
  return { secretId: match[1], secretKey: match[2] };
}

/** 接口只接受 10/20/30/40/50，按需要向上取整。 */
function cntFor(maxResults: number): number {
  const value = Math.max(1, Math.min(50, Math.round(Number(maxResults) || 10)));
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 30) return 30;
  if (value <= 40) return 40;
  return 50;
}

function freshnessFor(range: string | undefined): string {
  if (range === 'week') return 'd7';
  if (range === 'month') return 'm1';
  if (range === 'year') return 'y1';
  return '';
}

export async function searchTencent(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) {
    throw new Error('腾讯云搜索需要 SecretId:SecretKey（或复用带 Key 的平台）');
  }
  const { secretId, secretKey } = parseTencentSecret(key);
  const endpoint = String(platform.baseUrl || '').trim() || `https://${SERVICE}.tencentcloudapi.com`;
  const url = new URL(endpoint);
  const host = url.host;

  const payload: Record<string, unknown> = {
    Query: query.slice(0, 128),
    Cnt: cntFor(settings.search.maxResults),
    Mode: 2
  };
  const freshness = freshnessFor(settings.search.timeRange);
  if (freshness) payload.Freshness = freshness;
  const body = JSON.stringify(payload);

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-tc-action:searchpro\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body)
  ].join('\n');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    `${date}/${SERVICE}/tc3_request`,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await timeoutFetch(url.href, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      'x-tc-action': 'SearchPro',
      'x-tc-timestamp': String(timestamp),
      'x-tc-version': VERSION
    },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`腾讯云搜索 HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    Response?: { Pages?: unknown[]; Error?: { Code?: string; Message?: string } };
  };
  const response = data?.Response || {};
  if (response.Error) {
    throw new Error(
      `腾讯云搜索失败：${response.Error.Code || ''} ${response.Error.Message || ''}`.trim()
    );
  }
  const pages = Array.isArray(response.Pages) ? response.Pages : [];
  const rows: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    try {
      const parsed = JSON.parse(String(page)) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') rows.push(parsed);
    } catch {
      // 单条坏数据不影响整批
    }
  }
  return rows
    .slice(0, Math.max(1, settings.search.maxResults))
    .map((row) => {
      const passage = String(row.passage || '');
      const content = String(row.content || '');
      return {
        title: String(row.title || row.url || ''),
        url: String(row.url || ''),
        snippet: passage || content,
        ...(row.site ? { site: String(row.site) } : {}),
        ...(row.date ? { date: String(row.date) } : {}),
        ...(passage || content ? { summary: passage || content } : {})
      } as WebReference;
    })
    .filter((row) => Boolean(row.url));
}
