import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { McpResourceUpdate, McpServer } from '../shared/types';
import {
  readMcpResource,
  subscribeMcpResource,
  unsubscribeMcpResource
} from './mcp';

interface Watch {
  server: McpServer;
  uri: string;
  hash: string;
  content: string;
}

const watches = new Map<string, Watch>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

function key(server: McpServer, uri: string): string {
  return `${server.id}|${uri}`;
}

function digest(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function broadcast(update: McpResourceUpdate): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mcp:resource-updated', update);
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const watch of watches.values()) {
      try {
        const content = await readMcpResource(watch.server, watch.uri);
        const hash = digest(content);
        if (hash === watch.hash) continue;
        const first = !watch.hash;
        watch.hash = hash;
        watch.content = content;
        if (!first) {
          broadcast({
            serverId: watch.server.id,
            uri: watch.uri,
            content: content.slice(0, 4000),
            at: Date.now()
          });
        }
      } catch {
        // 单个资源读取失败不影响其他订阅
      }
    }
  } finally {
    ticking = false;
  }
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 20_000);
  timer.unref();
}

export async function watchMcpResource(server: McpServer, uri: string): Promise<void> {
  const entryKey = key(server, uri);
  if (watches.has(entryKey)) return;
  if (watches.size >= 20) throw new Error('最多同时订阅 20 个资源');
  watches.set(entryKey, { server, uri, hash: '', content: '' });
  ensureTimer();
  await subscribeMcpResource(server, uri);
  void tick();
}

export async function unwatchMcpResource(server: McpServer, uri: string): Promise<void> {
  watches.delete(key(server, uri));
  await unsubscribeMcpResource(server, uri);
}

/** 重新打开设置页时，把已保存的订阅恢复起来。 */
export function restoreMcpSubscriptions(servers: McpServer[]): void {
  for (const server of servers) {
    for (const uri of server.subscriptions || []) {
      const entryKey = key(server, uri);
      if (!watches.has(entryKey) && watches.size < 20) {
        watches.set(entryKey, { server, uri, hash: '', content: '' });
      }
    }
  }
  if (watches.size) ensureTimer();
}

export function disposeMcpSubscriptions(): void {
  if (timer) clearInterval(timer);
  timer = null;
  watches.clear();
}
