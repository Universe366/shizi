import type { AppSettings, WebReference } from '../../../shared/types';
import { timeoutFetch } from './shared';

interface RpcPayload {
  result?: { content?: Array<{ text?: string }> };
  error?: unknown;
}

export function parseRpcPayload(raw: string): RpcPayload | null {
  const text = String(raw || '').trim();
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as RpcPayload;
    } catch {
      // 继续按 SSE 解析
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload) as RpcPayload;
      if (json && (json.result || json.error)) return json;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseExaText(text: string): WebReference[] {
  const rows: WebReference[] = [];
  for (const chunk of String(text || '').split(/\n(?=Title:)/)) {
    const title = /^Title:\s*(.*)$/m.exec(chunk);
    const url = /^URL:\s*(\S+)/m.exec(chunk);
    if (!title || !url) continue;
    let body = chunk;
    const highlights = chunk.indexOf('Highlights:');
    if (highlights >= 0) body = chunk.slice(highlights + 'Highlights:'.length);
    rows.push({
      title: title[1].trim(),
      url: url[1].trim(),
      snippet: body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000)
    });
  }
  return rows;
}

export async function searchExa(query: string, settings: AppSettings): Promise<WebReference[]> {
  const endpoint = 'https://mcp.exa.ai/mcp';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  const init = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'shizi', version: '1' }
      }
    })
  });
  if (!init.ok) throw new Error(`Exa 握手 HTTP ${init.status}`);
  const sessionId = init.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await init.text().catch(() => '');
  await timeoutFetch(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    10000
  ).catch(() => undefined);

  const call = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          numResults: Math.min(100, settings.search.maxResults)
        }
      }
    })
  });
  if (!call.ok) throw new Error(`Exa 调用 HTTP ${call.status}`);
  const json = parseRpcPayload(await call.text());
  const content = json?.result?.content;
  const text = Array.isArray(content)
    ? content
        .map((item) => item?.text || '')
        .filter(Boolean)
        .join('\n')
    : '';
  const rows = parseExaText(text);
  if (!rows.length) throw new Error('Exa 未返回可解析结果');
  return rows;
}
