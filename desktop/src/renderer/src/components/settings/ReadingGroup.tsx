import type { AppSettings } from '../../../../shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '../../../../shared/ass';
import {
  MEDIA_MAX_RATE,
  MEDIA_MIN_RATE,
  MEDIA_SLIDER_MAX,
  clampMediaRate,
  formatMediaRate
} from '../../../../shared/media';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 页面与阅读：选区工具条、字幕跟随、字幕缓存、播放倍速。 */
export function ReadingGroup({ value, onChange }: Props) {
  const rate = clampMediaRate(value.mediaRate);
  const siteCount = Object.keys(value.mediaSiteRates || {}).length;

  return (
    <>
      <SettingsSection title="页面与阅读" defaultOpen>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.selectionToolbar !== false}
            onChange={(event) => onChange({ selectionToolbar: event.target.checked })}
          />
          选中网页文字时显示「解释 / 翻译 / 总结」工具条
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.autoFollow !== false}
            onChange={(event) => onChange({ autoFollow: event.target.checked })}
          />
          字幕默认跟随播放高亮
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.cacheSubtitles !== false}
            onChange={(event) => onChange({ cacheSubtitles: event.target.checked })}
          />
          缓存字幕正文（最多 100 条）
        </label>
        {value.cacheSubtitles !== false && (
          <div className="settings-field">
            <div className="settings-label">字幕缓存天数（0 = 不缓存）</div>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={365}
              value={value.subtitleCacheDays ?? 30}
              onChange={(event) => onChange({ subtitleCacheDays: Number(event.target.value) || 0 })}
            />
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="播放速度">
        <div className="settings-label">
          默认倍速：{formatMediaRate(rate)}（地址栏的倍速按钮可快速调整）
        </div>
        <input
          className="settings-range"
          type="range"
          min={MEDIA_MIN_RATE}
          max={MEDIA_SLIDER_MAX}
          step={0.05}
          value={Math.min(MEDIA_SLIDER_MAX, rate)}
          onChange={(event) => onChange({ mediaRate: clampMediaRate(event.target.value) })}
        />
        <div className="settings-field">
          <input
            className="settings-input"
            type="number"
            min={MEDIA_MIN_RATE}
            max={MEDIA_MAX_RATE}
            step={0.05}
            value={rate}
            onChange={(event) => onChange({ mediaRate: clampMediaRate(event.target.value) })}
          />
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.mediaRememberSite !== false}
            onChange={(event) => onChange({ mediaRememberSite: event.target.checked })}
          />
          按站点记住倍速（下次打开同一站点自动套用）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.mediaPreservePitch !== false}
            onChange={(event) => onChange({ mediaPreservePitch: event.target.checked })}
          />
          变速不变调（关闭后音调会随速度变化）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.mediaSingleKey === true}
            onChange={(event) => onChange({ mediaSingleKey: event.target.checked })}
          />
          单键调速 A / S / D（可能与 B 站 D 键弹幕冲突）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.mediaWidget !== false}
            onChange={(event) => onChange({ mediaWidget: event.target.checked })}
          />
          倍速不为 1× 时在网页右下角显示角标（点击可打开面板）
        </label>

        <div className="settings-field">
          <div className="settings-label">已记住 {siteCount} 个站点的倍速</div>
          <button
            className="mini-btn"
            disabled={siteCount === 0}
            onClick={() => onChange({ mediaSiteRates: {} })}
          >
            清除站点记忆
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="字幕与翻译">
        <div className="settings-hint">翻译默认行为；断句和成片参数在对应弹窗里单独调。</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.translateContext !== false}
            onChange={(event) => onChange({ translateContext: event.target.checked })}
          />
          翻译时带前后文（术语和语气更一致，提示词略长）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.translateReflect === true}
            onChange={(event) => onChange({ translateReflect: event.target.checked })}
          />
          译完让 AI 对照原文反思一次（耗时约翻倍）
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.translateFreeFallback === true}
            onChange={(event) => onChange({ translateFreeFallback: event.target.checked })}
          />
          AI 不可用/失败时用 MyMemory 免费翻译兜底（字幕文本会发给第三方）
        </label>

        <div className="settings-field">
          <div className="settings-label">翻译并发批数（1-3）</div>
          <select
            className="settings-input"
            value={String(value.translateConcurrency ?? 2)}
            onChange={(event) => onChange({ translateConcurrency: Number(event.target.value) })}
          >
            <option value="1">1 · 最稳</option>
            <option value="2">2 · 推荐</option>
            <option value="3">3 · 最快（可能触发限流）</option>
          </select>
        </div>
      </SettingsSection>

      <SettingsSection title="成片样式">
        <div className="settings-hint">
          默认样式；成片弹窗里还能临时改，并「保存为预设」。
        </div>
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">字号</div>
            <input
              className="settings-input"
              type="number"
              min={20}
              max={120}
              value={value.subtitleStyle?.fontSize ?? DEFAULT_SUBTITLE_STYLE.fontSize}
              onChange={(event) =>
                onChange({
                  subtitleStyle: {
                    ...DEFAULT_SUBTITLE_STYLE,
                    ...value.subtitleStyle,
                    fontSize: Number(event.target.value) || DEFAULT_SUBTITLE_STYLE.fontSize
                  }
                })
              }
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">距底部</div>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={300}
              value={value.subtitleStyle?.marginV ?? DEFAULT_SUBTITLE_STYLE.marginV}
              onChange={(event) =>
                onChange({
                  subtitleStyle: {
                    ...DEFAULT_SUBTITLE_STYLE,
                    ...value.subtitleStyle,
                    marginV: Number(event.target.value) || 0
                  }
                })
              }
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">描边</div>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={10}
              value={value.subtitleStyle?.outline ?? DEFAULT_SUBTITLE_STYLE.outline}
              onChange={(event) =>
                onChange({
                  subtitleStyle: {
                    ...DEFAULT_SUBTITLE_STYLE,
                    ...value.subtitleStyle,
                    outline: Number(event.target.value) || 0
                  }
                })
              }
            />
          </div>
        </div>
        <div className="settings-hint">
          已保存 {value.subtitlePresets?.length || 0} 个预设（在成片弹窗里保存/套用）。
        </div>
      </SettingsSection>
    </>
  );
}
