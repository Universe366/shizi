import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['ocr'];
  onChange: (patch: Partial<AppSettings['ocr']>) => void;
}

/** 文字识别：系统 OCR（离线）、自建 PaddleOCR，或视觉大模型。 */
export function OcrSection({ value, onChange }: Props) {
  return (
    <SettingsSection title="文字识别（OCR）" defaultOpen={false}>
      <div className="settings-hint">
        截图取字默认用 Windows 自带 OCR（离线、免下载）；也可以接自建 PaddleOCR，或直接用支持图片输入的视觉大模型。
      </div>
      <div className="settings-inline">
        <select
          className="settings-input"
          value={value.engine}
          onChange={(event) =>
            onChange({ engine: event.target.value as AppSettings['ocr']['engine'] })
          }
        >
          <option value="system">Windows 系统 OCR（推荐）</option>
          <option value="paddle">PaddleOCR 服务（自建）</option>
          <option value="ai">视觉大模型（按任务选模型）</option>
        </select>
      </div>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">识别语言</div>
          <select
            className="settings-input"
            value={value.lang}
            onChange={(event) => onChange({ lang: event.target.value })}
          >
            <option value="auto">跟随系统</option>
            <option value="zh-Hans-CN">简体中文</option>
            <option value="zh-Hant-TW">繁体中文</option>
            <option value="en-US">English</option>
            <option value="ja-JP">日本語</option>
          </select>
        </div>
      </div>
      {value.engine === 'ai' && (
        <div className="settings-hint">
          视觉模型在「AI 与模型 → 按任务选模型 → 文字识别」里单独选择；
          需要模型支持图片输入，否则请求会失败。
        </div>
      )}
      {value.engine === 'paddle' && (
        <>
          <div className="settings-label">PaddleOCR 服务地址</div>
          <input
            className="settings-input"
            placeholder="http://127.0.0.1:8866/predict/ocr_system"
            spellCheck={false}
            value={value.paddleUrl}
            onChange={(event) => onChange({ paddleUrl: event.target.value })}
          />
          <div className="settings-hint">
            服务需要接收 <code>{'{ image: base64 }'}</code> 并返回文字；失败会自动回退 Windows OCR。
            也可以自己用 PaddleOCR 的 serving / FastAPI 包装一层。
          </div>
        </>
      )}
    </SettingsSection>
  );
}
