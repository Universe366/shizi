import { useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../../../../shared/types';
import {
  FIXED_SHORTCUT_GROUPS,
  SHORTCUT_ACTIONS,
  duplicateShortcuts,
  effectiveShortcuts,
  shortcutActionGroups,
  shortcutDisplay,
  type ShortcutActionId
} from '../../../../shared/shortcuts';
import {
  formatShortcut,
  isRecordableStroke,
  strokeFromEvent
} from '../../../../shared/shortcutKeys';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface ShortcutsSectionProps {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

interface ShortcutState {
  id: 'shot' | 'voice' | 'chat';
  accelerator: string;
  registered: boolean;
  error: string;
}

/** 快捷键：可自定义应用内动作 + 全局快捷键开关 + 固定键位表。 */
export function ShortcutsSection({ value, onChange }: ShortcutsSectionProps) {
  const [states, setStates] = useState<ShortcutState[]>([]);
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [error, setError] = useState('');

  const overrides = value.shortcuts || {};
  const map = useMemo(() => effectiveShortcuts(overrides), [overrides]);
  const conflicts = useMemo(() => duplicateShortcuts(map), [map]);

  useEffect(() => {
    let alive = true;
    void window.bsub
      .petShortcutsStatus?.()
      .then((list) => {
        if (alive) setStates(Array.isArray(list) ? list : []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 录制：按下组合键后写入；Esc 取消，纯修饰键/无修饰普通字符不允许。
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setError('');
        return;
      }
      const stroke = strokeFromEvent(event);
      if (!stroke) return;
      if (!isRecordableStroke(stroke)) {
        setError('请至少按住 Ctrl 或 Alt（F1–F24 可直接用）');
        return;
      }
      const next = formatShortcut(stroke);
      const clash = SHORTCUT_ACTIONS.find(
        (action) => action.id !== recording && map[action.id] === next
      );
      if (clash) {
        setError(`这个组合已经被「${clash.label}」占用`);
        return;
      }
      onChange({ shortcuts: { ...overrides, [recording]: next } });
      setRecording(null);
      setError('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [map, onChange, overrides, recording]);

  const resetOne = (id: ShortcutActionId) => {
    const next = { ...overrides };
    delete next[id];
    onChange({ shortcuts: next });
    setError('');
  };

  const resetAll = () => {
    onChange({ shortcuts: {} });
    setError('');
  };

  const globalEnabled = (id: ShortcutState['id']) =>
    id === 'shot'
      ? value.petShortcut !== false
      : id === 'voice'
        ? value.petVoiceShortcut !== false
        : value.petChatShortcut !== false;

  return (
    <SettingsSection title="快捷键" defaultOpen={false}>
      <div className="settings-hint">
        点「修改」后直接按下新的组合键；Esc 取消。标记「仅网页」的动作只在焦点位于网页里时生效。
      </div>

      {conflicts.length > 0 && (
        <div className="settings-hint" style={{ color: 'var(--danger)' }}>
          有重复绑定：
          {conflicts
            .map((ids) =>
              ids.map((id) => SHORTCUT_ACTIONS.find((item) => item.id === id)?.label || id).join(' / ')
            )
            .join('；')}
        </div>
      )}

      {shortcutActionGroups().map((group) => (
        <div className="settings-group" key={group.title}>
          <div className="settings-group-title">{group.title}</div>
          <div className="shortcut-list">
            {group.items.map((action) => {
              const custom = Boolean(overrides[action.id]);
              const active = map[action.id];
              return (
                <div className="shortcut-row" key={action.id}>
                  <span className="shortcut-keys">{shortcutDisplay(active)}</span>
                  <span className="shortcut-label">
                    {action.label}
                    {action.scope === 'page' && <span className="shortcut-scope">仅网页</span>}
                    {action.scope === 'media' && <span className="shortcut-scope">网页内</span>}
                    {custom && <span className="shortcut-scope">已改</span>}
                  </span>
                  <span className="shortcut-actions">
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setRecording(action.id);
                        setError('');
                      }}
                    >
                      {recording === action.id ? '按下新键…' : '修改'}
                    </button>
                    {custom && (
                      <button className="mini-btn" onClick={() => resetOne(action.id)}>
                        恢复默认
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {recording && (
        <div className="settings-hint">
          正在修改「{SHORTCUT_ACTIONS.find((item) => item.id === recording)?.label}」：请按下新组合键，
          或按 Esc 取消。
        </div>
      )}
      {error && (
        <div className="settings-hint" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <div className="settings-inline">
        <button className="mini-btn" onClick={resetAll}>
          全部恢复默认
        </button>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">全局快捷键</div>
        <div className="settings-group-desc">
          即使焦点不在拾字窗口里也能触发；如果和别的软件冲突，可以在这里关掉。
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petShortcut !== false}
            onChange={(event) => onChange({ petShortcut: event.target.checked })}
          />
          框选截图 Ctrl + Alt + S
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petVoiceShortcut !== false}
            onChange={(event) => onChange({ petVoiceShortcut: event.target.checked })}
          />
          语音提问 Ctrl + Shift + Space
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petChatShortcut !== false}
            onChange={(event) => onChange({ petChatShortcut: event.target.checked })}
          />
          打开对话 Ctrl + Shift + E
        </label>

        {states
          .filter((item) => globalEnabled(item.id))
          .map((item) => (
            <div className="settings-hint" key={item.id}>
              {item.registered
                ? `已注册：${item.accelerator}`
                : `注册失败（${item.error || '可能被其他程序占用'}）：${item.accelerator}`}
            </div>
          ))}
        <div className="settings-hint">修改后需要保存设置；桌宠没启用时，全局快捷键不会注册。</div>
      </div>

      {FIXED_SHORTCUT_GROUPS.filter((group) => group.title !== '全局快捷键').map((group) => (
        <div className="settings-group" key={group.title}>
          <div className="settings-group-title">{group.title}</div>
          <div className="shortcut-list">
            {group.items.map((item) => (
              <div className="shortcut-row" key={`${group.title}-${item.keys}`}>
                <span className="shortcut-keys">{item.keys}</span>
                <span className="shortcut-label">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}
