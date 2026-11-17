import { useEffect, useState } from 'react';
import type { SidebarPage } from '../../../shared/types';

const CACHE_KEY = 'sidebar.pageIcons';
const memory = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function cacheStore(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function readCache(origin: string): string | null {
  if (memory.has(origin)) return memory.get(origin) ?? null;
  const store = cacheStore();
  if (!(origin in store)) return null;
  const value = typeof store[origin] === 'string' ? store[origin] : '';
  memory.set(origin, value);
  return value;
}

function writeCache(origin: string, icon: string): void {
  memory.set(origin, icon);
  try {
    const store = cacheStore();
    store[origin] = icon;
    const keys = Object.keys(store);
    if (keys.length > 60) {
      for (const key of keys.slice(0, keys.length - 60)) delete store[key];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // 配额满/隐私模式时忽略，图标下次再探测。
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function directIcon(url: string): string {
  try {
    return new URL('/favicon.ico', url).toString();
  } catch {
    return '';
  }
}

function fallbackText(title: string): string {
  const text = String(title || '').trim();
  if (!text) return '?';
  // 中文取前两个字（智谱/腾讯），英文取首字母（D/K/C）。
  return /^[\u4e00-\u9fa5]/.test(text) ? text.slice(0, 2) : text.slice(0, 1).toUpperCase();
}

function probeIcon(page: SidebarPage, origin: string): Promise<string> {
  const existing = pending.get(origin);
  if (existing) return existing;
  const task = (async () => {
    try {
      const response = await window.bsub.startProbeSite?.(page.url);
      const icon = response?.ok ? String(response.data.icon || '') : '';
      if (/^https?:\/\//i.test(icon)) {
        writeCache(origin, icon);
        return icon;
      }
    } catch {
      // 探针失败就回退首字。
    }
    writeCache(origin, '');
    return '';
  })().finally(() => pending.delete(origin));
  pending.set(origin, task);
  return task;
}

/** 侧栏网页图标：先试站点 /favicon.ico，失败再用页面 meta 里的 icon，最后回退首字。 */
export function SidebarPageIcon({ page }: { page: SidebarPage }) {
  const origin = originOf(page.url);
  const cached = origin ? readCache(origin) : null;
  const [src, setSrc] = useState(() => cached || (origin ? directIcon(page.url) : ''));
  const [mode, setMode] = useState<'direct' | 'cached' | 'probe' | 'fallback'>(() => {
    if (!origin) return 'fallback';
    if (cached === '') return 'fallback';
    if (cached) return 'cached';
    return 'direct';
  });
  const [probeStarted, setProbeStarted] = useState(false);

  useEffect(() => {
    const nextOrigin = originOf(page.url);
    const nextCached = nextOrigin ? readCache(nextOrigin) : null;
    setSrc(nextCached || (nextOrigin ? directIcon(page.url) : ''));
    setMode(
      !nextOrigin ? 'fallback' : nextCached === '' ? 'fallback' : nextCached ? 'cached' : 'direct'
    );
    setProbeStarted(false);
  }, [page.url]);

  useEffect(() => {
    if (mode !== 'probe' || probeStarted) return;
    setProbeStarted(true);
    let alive = true;
    void probeIcon(page, origin).then((icon) => {
      if (!alive) return;
      if (icon) {
        setSrc(icon);
        setMode('cached');
      } else {
        setMode('fallback');
      }
    });
    return () => {
      alive = false;
    };
  }, [mode, origin, page, probeStarted]);

  const fail = () => {
    if (mode === 'direct') {
      setMode('probe');
    } else {
      setMode('fallback');
    }
  };

  const text = fallbackText(page.title);
  return (
    <span className="side-nav-icon-wrap">
      {/* 首字垫底：图标加载慢或失败时也有可点击的稳定尺寸，不会闪空。 */}
      <span className={`side-nav-letter${text.length > 1 ? ' is-long' : ''}`}>{text}</span>
      {mode !== 'fallback' && src && (
        <img
          className="side-nav-favicon"
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={fail}
        />
      )}
    </span>
  );
}
