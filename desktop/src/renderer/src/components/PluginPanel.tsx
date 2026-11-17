import { useEffect, useRef } from 'react';
import type { PluginInfo, PluginPanelContribution } from '../../../shared/plugins';
import { pluginEntryUrl } from '../../../shared/plugins';

interface PluginPanelProps {
  plugin: PluginInfo;
  panel: PluginPanelContribution;
}

/**
 * 插件面板宿主。
 *
 * 插件页面通过 shizi-plugin:// 协议加载到 iframe，不能访问应用 DOM；
 * 能力调用走 postMessage → 父窗口 → 主进程 plugins:rpc，权限由 manifest 决定。
 *
 * 约定：
 *   iframe → host: { source: 'shizi-plugin', id, method, params }
 *   host → iframe: { source: 'shizi-host', id, ok, data?, error? }
 */
export function PluginPanel({ plugin, panel }: PluginPanelProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onMessage = async (event: MessageEvent) => {
      // 只接受这个 iframe 自己发来的消息；插件之间不能互相冒充。
      if (event.source !== frame.contentWindow) return;
      const data = event.data as
        | { source?: string; id?: string; method?: string; params?: unknown }
        | null;
      if (!data || data.source !== 'shizi-plugin' || !data.id || !data.method) return;
      const result = await window.bsub.pluginRpc(plugin.id, String(data.method), data.params);
      frame.contentWindow?.postMessage(
        {
          source: 'shizi-host',
          id: data.id,
          ok: result.ok,
          data: result.ok ? result.data : undefined,
          error: result.ok ? '' : result.error
        },
        '*'
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [plugin.id]);

  return (
    <iframe
      ref={frameRef}
      className="plugin-frame"
      title={`${plugin.name} · ${panel.title}`}
      src={pluginEntryUrl(plugin.id, panel.entry)}
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
