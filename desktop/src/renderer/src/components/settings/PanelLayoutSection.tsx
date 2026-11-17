import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import type { PanelLayout } from '../../../../shared/types';
import {
  BUILTIN_PANELS,
  mergePanelOrder,
  panelLabel
} from '../../../../shared/panels';
import { SettingsSection } from './SettingsSection';

interface PanelLayoutSectionProps {
  value: PanelLayout;
  onChange: (next: PanelLayout) => void;
}

/**
 * 侧栏面板布局：内置面板与插件面板统一排序、显隐。
 * 这里改的是设置草稿，点「保存」后主窗口侧栏立即按新布局重排。
 */
export function PanelLayoutSection({ value, onChange }: PanelLayoutSectionProps) {
  const [pluginLabels, setPluginLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void window.bsub.listPlugins().then((result) => {
      if (!alive || !result.ok) return;
      const labels: Record<string, string> = {};
      for (const plugin of result.data.plugins) {
        for (const panel of plugin.panels) {
          labels[`plugin:${plugin.id}:${panel.id}`] = `${plugin.name} · ${panel.title}`;
        }
      }
      setPluginLabels(labels);
    });
    return () => {
      alive = false;
    };
  }, []);

  const allKeys = useMemo(
    () => [
      ...BUILTIN_PANELS.map((panel) => panel.id as string),
      ...Object.keys(pluginLabels)
    ],
    [pluginLabels]
  );
  const order = useMemo(() => mergePanelOrder(value.order, allKeys), [value.order, allKeys]);
  const hidden = new Set(value.hidden);
  const visibleCount = order.filter((key) => !hidden.has(key)).length;

  const move = (key: string, delta: number) => {
    const index = order.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...value, order: next });
  };

  const toggle = (key: string) => {
    const nextHidden = hidden.has(key)
      ? value.hidden.filter((item) => item !== key)
      : [...value.hidden, key];
    // 至少留一个可见面板，否则侧栏会空掉。
    if (order.every((item) => nextHidden.includes(item))) return;
    onChange({ ...value, hidden: nextHidden });
  };

  return (
    <SettingsSection
      title="侧栏面板"
      description="调整内置面板与插件面板的顺序，或隐藏不用的面板"
      defaultOpen={false}
    >
      <div className="settings-hint">
        顺序会同时作用于字幕/总结/对话与插件面板；隐藏的面板仍在，只是不出现在侧栏导航里。
        至少保留一个可见面板。
      </div>

      {order.map((key, index) => {
        const isHidden = hidden.has(key);
        const lastVisible = !isHidden && visibleCount <= 1;
        return (
          <div key={key} className={`panel-layout-row${isHidden ? ' is-hidden' : ''}`}>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={!isHidden}
                disabled={lastVisible}
                onChange={() => toggle(key)}
              />
              <span>{panelLabel(key, pluginLabels)}</span>
            </label>
            <span className="panel-layout-key">{key}</span>
            <span className="panel-layout-actions">
              <button
                className="mini-btn"
                disabled={index === 0}
                title="上移"
                onClick={() => move(key, -1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                className="mini-btn"
                disabled={index === order.length - 1}
                title="下移"
                onClick={() => move(key, 1)}
              >
                <ArrowDown size={13} />
              </button>
            </span>
          </div>
        );
      })}

      <div className="settings-inline">
        <button
          className="mini-btn"
          onClick={() => onChange({ order: [], hidden: [] })}
          title="恢复默认顺序并显示全部面板"
        >
          <RotateCcw size={13} /> 恢复默认
        </button>
      </div>
    </SettingsSection>
  );
}
