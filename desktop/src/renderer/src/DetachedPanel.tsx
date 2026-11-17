import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Minus, Pin, PinOff, X } from 'lucide-react';
import type { TabInfo } from '../../shared/types';
import type { PluginInfo } from '../../shared/plugins';
import { parsePluginSection } from '../../shared/plugins';
import { SubtitlesPanel } from './components/SubtitlesPanel';
import { ChatPanel } from './components/ChatPanel';
import { SummaryPanel } from './components/SummaryPanel';
import { PluginPanel } from './components/PluginPanel';
import { applyAppearance } from './lib/appearance';

const SettingsPage = lazy(() =>
  import('./SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const LibraryPage = lazy(() =>
  import('./components/LibraryPage').then((module) => ({ default: module.LibraryPage }))
);

/**
 * 独立面板窗口（?window=panel&section=…）。
 *
 * 复用侧栏面板组件，但自己取标签页与设置；没有主窗口的全局状态。
 * 标题栏可拖动（-webkit-app-region: drag），按钮区不响应拖动。
 */
export function DetachedPanel() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const section = params.get('section') || 'subtitles';
  const title = params.get('title') || '面板';
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    void window.bsub.listTabs().then((list) => setTabs(list));
    const off = window.bsub.onTabs((list) => setTabs(list));
    return off;
  }, []);

  useEffect(() => {
    void window.bsub.getSettings().then((result) => {
      if (result.ok) applyAppearance(result.data.settings.general);
    });
    void window.bsub.listPanelWindows().then((result) => {
      if (!result.ok) return;
      setPinned(result.data.find((item) => item.section === section)?.alwaysOnTop === true);
    });
    if (section.startsWith('plugin:')) {
      void window.bsub.listPlugins().then((result) => {
        if (result.ok) setPlugins(result.data.plugins);
      });
    }
  }, [section]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.active) || null, [tabs]);
  const pluginTarget = useMemo(() => {
    const parsed = parsePluginSection(section);
    if (!parsed) return null;
    const plugin = plugins.find((item) => item.id === parsed.pluginId && item.enabled);
    const panel = plugin?.panels.find((item) => item.id === parsed.panelId);
    return plugin && panel ? { plugin, panel } : null;
  }, [plugins, section]);

  const togglePin = async () => {
    const next = !pinned;
    const result = await window.bsub.setPanelAlwaysOnTop(section, next);
    if (result.ok) setPinned(next);
  };

  let body = null;
  if (section === 'subtitles') {
    body = (
      <SubtitlesPanel
        activeTab={activeTab}
        onOpenSummary={() => void window.bsub.openMainSection('summary')}
        onOpenChapters={() => void window.bsub.openMainSection('summary')}
      />
    );
  } else if (section === 'chat') {
    body = <ChatPanel activeTab={activeTab} onOpenSettings={() => void window.bsub.openSettings()} />;
  } else if (section === 'summary') {
    body = (
      <SummaryPanel activeTab={activeTab} onOpenSettings={() => void window.bsub.openSettings()} />
    );
  } else if (section === 'settings') {
    body = (
      <Suspense fallback={null}>
        <SettingsPage onClose={() => window.close()} />
      </Suspense>
    );
  } else if (section === 'library') {
    body = (
      <Suspense fallback={null}>
        <LibraryPage onClose={() => window.close()} />
      </Suspense>
    );
  } else if (section.startsWith('plugin:')) {
    body = pluginTarget ? (
      <PluginPanel plugin={pluginTarget.plugin} panel={pluginTarget.panel} />
    ) : (
      <div className="detached-empty">插件面板不可用：插件可能已被停用或卸载。</div>
    );
  } else {
    body = <div className="detached-empty">这个面板还不支持拆成独立窗口。</div>;
  }

  return (
    <div className="detached-root">
      <header className="detached-bar">
        <span className="detached-dot" />
        <span className="detached-title" title={section}>
          {title}
        </span>
        <button
          className={`detached-btn${pinned ? ' is-active' : ''}`}
          onClick={() => void togglePin()}
          title={pinned ? '取消置顶' : '窗口置顶'}
        >
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        <button
          className="detached-btn"
          onClick={() => void window.bsub.closePanelWindow(section)}
          title="合回主窗口"
        >
          <Minus size={13} />
        </button>
        <button className="detached-btn" onClick={() => window.close()} title="关闭">
          <X size={13} />
        </button>
      </header>
      <main className="detached-body">{body}</main>
    </div>
  );
}
