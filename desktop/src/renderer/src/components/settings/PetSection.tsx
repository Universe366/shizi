import type { AppSettings, PetTheme } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface PetSectionProps {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

const THEMES: Array<{ id: PetTheme; label: string; colors: [string, string] }> = [
  { id: 'sakura', label: '樱花粉', colors: ['#ffd3e2', '#f57dab'] },
  { id: 'mint', label: '薄荷绿', colors: ['#d9f6e7', '#6ccfa4'] },
  { id: 'sunset', label: '落日橙', colors: ['#ffe4c7', '#f28a54'] },
  { id: 'midnight', label: '夜空蓝', colors: ['#dfe2ff', '#858dd9'] },
  { id: 'graphite', label: '石墨灰', colors: ['#ececf1', '#a9a9b4'] }
];

/** 桌面宠物：外观、交互、声音与位置，尽量把能 DIY 的都露出来。 */
export function PetSection({ value, onChange }: PetSectionProps) {
  const idleMinutes = value.petIdleTalkMinutes ?? 3;
  const sleepMinutes = value.petSleepMinutes ?? 5;

  return (
    <>
      <SettingsSection title="桌面宠物" defaultOpen>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petEnabled === true}
            onChange={(event) => onChange({ petEnabled: event.target.checked })}
          />
          启用桌面宠物
        </label>

        <div className="settings-label">桌宠名字（显示在气泡标题）</div>
        <input
          className="settings-input"
          type="text"
          maxLength={12}
          value={value.petName || '即时助手'}
          placeholder="即时助手"
          onChange={(event) => onChange({ petName: event.target.value.slice(0, 12) })}
        />

        <div className="settings-label">配色</div>
        <div className="pet-theme-row">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`pet-swatch${(value.petTheme || 'sakura') === theme.id ? ' is-active' : ''}`}
              title={theme.label}
              aria-label={theme.label}
              aria-pressed={(value.petTheme || 'sakura') === theme.id}
              style={{
                background: `linear-gradient(160deg, ${theme.colors[0]}, ${theme.colors[1]})`
              }}
              onClick={() => onChange({ petTheme: theme.id })}
            />
          ))}
        </div>

        <div className="settings-label">大小（{value.petSize || 96}px）</div>
        <input
          className="settings-range"
          type="range"
          min={64}
          max={180}
          step={4}
          value={value.petSize || 96}
          onChange={(event) => onChange({ petSize: Number(event.target.value) || 96 })}
        />
        <div className="toolbar-actions">
          {[
            { label: '小', size: 72, hint: '不挡视线' },
            { label: '中', size: 96, hint: '默认' },
            { label: '大', size: 140, hint: '看得清表情' }
          ].map((preset) => (
            <button
              key={preset.label}
              className={`mini-btn${(value.petSize || 96) === preset.size ? ' is-active' : ''}`}
              title={preset.hint}
              onClick={() => onChange({ petSize: preset.size })}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="settings-label">
          不透明度（{Math.round((value.petOpacity ?? 1) * 100)}%）
        </div>
        <input
          className="settings-range"
          type="range"
          min={0.4}
          max={1}
          step={0.05}
          value={value.petOpacity ?? 1}
          onChange={(event) => onChange({ petOpacity: Number(event.target.value) || 1 })}
        />

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petMotion !== false}
            onChange={(event) => onChange({ petMotion: event.target.checked })}
          />
          呼吸 / 眨眼 / 浮动等动效
        </label>
      </SettingsSection>

      <SettingsSection title="桌宠交互">
        <div className="settings-label">单击桌宠</div>
        <select
          className="settings-input"
          value={value.petClickAction || 'chat'}
          onChange={(event) =>
            onChange({ petClickAction: event.target.value as General['petClickAction'] })
          }
        >
          <option value="chat">打开对话气泡</option>
          <option value="screenshot">直接框选截图</option>
          <option value="none">什么都不做</option>
        </select>

        <div className="settings-label">双击桌宠</div>
        <select
          className="settings-input"
          value={value.petDoubleClickAction || 'main'}
          onChange={(event) =>
            onChange({ petDoubleClickAction: event.target.value as General['petDoubleClickAction'] })
          }
        >
          <option value="main">打开主窗口</option>
          <option value="screenshot">直接框选截图</option>
          <option value="none">什么都不做</option>
        </select>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petSnap !== false}
            onChange={(event) => onChange({ petSnap: event.target.checked })}
          />
          松手时吸附屏幕边缘
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petAlwaysOnTop !== false}
            onChange={(event) => onChange({ petAlwaysOnTop: event.target.checked })}
          />
          窗口置顶
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petShortcut !== false}
            onChange={(event) => onChange({ petShortcut: event.target.checked })}
          />
          启用全局截图快捷键 Ctrl+Shift+S
        </label>
      </SettingsSection>

      <SettingsSection title="声音与状态">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petSound !== false}
            onChange={(event) => onChange({ petSound: event.target.checked })}
          />
          点击音效
        </label>
        <div className="settings-label">音效音量（{value.petSoundVolume ?? 60}%）</div>
        <input
          className="settings-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={value.petSoundVolume ?? 60}
          disabled={value.petSound === false}
          onChange={(event) => onChange({ petSoundVolume: Number(event.target.value) })}
        />

        <div className="settings-label">朗读语速（{(value.petSpeechRate ?? 1).toFixed(1)}×）</div>
        <input
          className="settings-range"
          type="range"
          min={0.6}
          max={2}
          step={0.1}
          value={value.petSpeechRate ?? 1}
          onChange={(event) => onChange({ petSpeechRate: Number(event.target.value) })}
        />

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.petIdleTalk !== false}
            onChange={(event) => onChange({ petIdleTalk: event.target.checked })}
          />
          空闲时自言自语
        </label>

        <div className="settings-label">自言自语间隔</div>
        <select
          className="settings-input"
          value={String(idleMinutes)}
          disabled={value.petIdleTalk === false}
          onChange={(event) => onChange({ petIdleTalkMinutes: Number(event.target.value) })}
        >
          <option value="0">关闭</option>
          <option value="1">1 分钟</option>
          <option value="3">3 分钟</option>
          <option value="5">5 分钟</option>
          <option value="10">10 分钟</option>
        </select>

        <div className="settings-label">无操作后睡觉</div>
        <select
          className="settings-input"
          value={String(sleepMinutes)}
          onChange={(event) => onChange({ petSleepMinutes: Number(event.target.value) })}
        >
          <option value="0">不睡</option>
          <option value="5">5 分钟</option>
          <option value="10">10 分钟</option>
          <option value="15">15 分钟</option>
          <option value="30">30 分钟</option>
          <option value="60">60 分钟</option>
        </select>
      </SettingsSection>

      <SettingsSection title="桌宠位置">
        <div className="settings-label">启动时位置</div>
        <select
          className="settings-input"
          value={value.petStartCorner || 'remember'}
          onChange={(event) =>
            onChange({ petStartCorner: event.target.value as General['petStartCorner'] })
          }
        >
          <option value="remember">记住上次位置</option>
          <option value="bottom-right">右下角</option>
          <option value="bottom-left">左下角</option>
          <option value="top-right">右上角</option>
          <option value="top-left">左上角</option>
        </select>

        <div className="toolbar-actions">
          <button
            className="mini-btn"
            onClick={() => {
              onChange({ petEnabled: true });
              void window.bsub.setPetEnabled(true);
            }}
          >
            立即显示
          </button>
          <button className="mini-btn" onClick={() => void window.bsub.resetPetPosition()}>
            重置桌宠位置
          </button>
        </div>
        <div className="settings-hint">
          拖动桌宠可移动位置（松手吸附屏幕边缘）；右键桌宠可看屏幕、问选中、暂停/继续播放、切换置顶或隐藏。
          关闭气泡后窗口会自动缩到桌宠大小，不会挡住桌面点击。修改后点「保存」生效。
        </div>
      </SettingsSection>
    </>
  );
}
