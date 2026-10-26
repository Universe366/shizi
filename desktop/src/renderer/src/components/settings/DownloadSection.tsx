import type { DownloadSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

/** 在线视频下载默认选项（参考 Bilidown：清晰度 / 音频 / 封面 / 字幕 / 元数据）。 */
export function DownloadSection({
  value,
  onChange
}: {
  value: DownloadSettings;
  onChange: (next: DownloadSettings) => void;
}) {
  return (
    <SettingsSection title="视频下载" defaultOpen={false}>
      <div className="settings-hint">
        资料库每条视频右侧的下载按钮、下载弹窗都会使用这里的默认选项；仅处理你有权保存的内容。
      </div>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">画质上限</div>
          <select
            className="settings-input"
            value={value.quality}
            disabled={value.audioOnly}
            onChange={(event) =>
              onChange({ ...value, quality: event.target.value as DownloadSettings['quality'] })
            }
          >
            <option value="best">最佳画质</option>
            <option value="2160">4K / 2160p</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
          </select>
        </div>
        <div className="settings-field">
          <div className="settings-label">音频格式</div>
          <select
            className="settings-input"
            value={value.audioFormat}
            disabled={!value.audioOnly}
            onChange={(event) =>
              onChange({
                ...value,
                audioFormat: event.target.value as DownloadSettings['audioFormat']
              })
            }
          >
            <option value="m4a">M4A</option>
            <option value="mp3">MP3</option>
          </select>
        </div>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.audioOnly}
          onChange={(event) => onChange({ ...value, audioOnly: event.target.checked })}
        />
        仅下载音频
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.cover}
          onChange={(event) => onChange({ ...value, cover: event.target.checked })}
        />
        同时保存封面
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.subtitles}
          onChange={(event) => onChange({ ...value, subtitles: event.target.checked })}
        />
        同时保存字幕（SRT）
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.metadata}
          onChange={(event) => onChange({ ...value, metadata: event.target.checked })}
        />
        同时保存元数据 / 简介
      </label>
    </SettingsSection>
  );
}
