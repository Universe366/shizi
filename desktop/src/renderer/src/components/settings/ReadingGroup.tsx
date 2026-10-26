import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 页面与阅读：目前只保留网页选区工具条；字幕/倍速/翻译在「字幕与播放」里。 */
export function ReadingGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="页面与阅读" defaultOpen>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.selectionToolbar !== false}
          onChange={(event) => onChange({ selectionToolbar: event.target.checked })}
        />
        选中网页文字时显示「解释 / 翻译 / 总结」工具条
      </label>
      <div className="settings-hint">
        字幕跟随、缓存、倍速、翻译和成片样式已经统一放到「字幕与播放」。
      </div>
    </SettingsSection>
  );
}
