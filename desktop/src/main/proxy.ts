import { session } from 'electron';
import type { AppSettings } from '../shared/types';

/**
 * 应用级代理：内置浏览器、AI/搜索请求（走 session.fetch）共用同一套。
 * 不在启动时阻塞：失败只记日志，退回系统代理。
 */
export async function applyProxy(settings: AppSettings): Promise<void> {
  const proxy = settings.general.proxy;
  try {
    if (!proxy || proxy.mode === 'system') {
      await session.defaultSession.setProxy({ mode: 'system' });
      return;
    }
    if (proxy.mode === 'none') {
      await session.defaultSession.setProxy({ mode: 'direct' });
      return;
    }
    const rules = String(proxy.url || '').trim();
    if (!rules) {
      await session.defaultSession.setProxy({ mode: 'system' });
      return;
    }
    await session.defaultSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: rules,
      proxyBypassRules: String(proxy.bypass || '')
    });
  } catch (error) {
    console.warn('[proxy] 应用代理失败:', (error as Error).message);
  }
}
