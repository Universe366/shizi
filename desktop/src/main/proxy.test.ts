import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../shared/types';

const setProxy = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('electron', () => ({
  session: { defaultSession: { setProxy } }
}));

import { applyProxy } from './proxy';

function settings(proxy: AppSettings['general']['proxy']): AppSettings {
  return { general: { proxy } } as unknown as AppSettings;
}

describe('应用级代理', () => {
  beforeEach(() => setProxy.mockClear());

  it('跟随系统', async () => {
    await applyProxy(settings({ mode: 'system', url: '', bypass: '' }));
    expect(setProxy).toHaveBeenCalledWith({ mode: 'system' });
  });

  it('直连', async () => {
    await applyProxy(settings({ mode: 'none', url: '', bypass: '' }));
    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' });
  });

  it('自定义代理带绕过规则', async () => {
    await applyProxy(
      settings({ mode: 'custom', url: 'http://127.0.0.1:7890', bypass: 'localhost' })
    );
    expect(setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'localhost'
    });
  });

  it('自定义但没填地址时退回系统代理', async () => {
    await applyProxy(settings({ mode: 'custom', url: '  ', bypass: '' }));
    expect(setProxy).toHaveBeenCalledWith({ mode: 'system' });
  });
});
