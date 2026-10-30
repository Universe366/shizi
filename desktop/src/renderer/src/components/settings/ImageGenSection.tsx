import { useState } from 'react';
import { Image, Loader2 } from 'lucide-react';
import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['image'];
  onChange: (patch: Partial<AppSettings['image']>) => void;
}

const PRESETS = [
  { id: 'openai', label: 'OpenAI（gpt-image-1）', provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
  { id: 'siliconflow', label: '硅基流动（Kolors）', provider: 'openai' as const, baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors' },
  { id: 'localai', label: 'LocalAI（本地 OpenAI 兼容）', provider: 'openai' as const, baseUrl: 'http://127.0.0.1:8080/v1', model: 'sdxl' },
  { id: 'a1111', label: 'SD WebUI / Forge（本地）', provider: 'a1111' as const, baseUrl: 'http://127.0.0.1:7860', model: '' },
  { id: 'comfyui', label: 'ComfyUI（本地工作流）', provider: 'comfyui' as const, baseUrl: 'http://127.0.0.1:8188', model: '' }
];

export function ImageGenSection({ value, onChange }: Props) {
  const [prompt, setPrompt] = useState('一只在窗边看雨的橘猫，电影感光线');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState('');

  const generate = async () => {
    setBusy(true);
    setNotice('');
    try {
      const response = await window.bsub.imageGenerate(prompt);
      if (!response.ok) {
        setNotice(`生成失败：${response.error}`);
        return;
      }
      setResult(response.data.dataUrl);
      setNotice(`${response.data.provider} · ${response.data.ms}ms`);
    } catch (error) {
      setNotice(`生成失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="图片生成" defaultOpen={false}>
      <div className="settings-hint">
        OpenAI 兼容接口（含硅基流动/LocalAI）、本地 SD WebUI、本地 ComfyUI 工作流。
        本地生成不需要 Key，只要服务在本机运行。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用图片生成
      </label>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">服务预设</div>
          <select
            className="settings-input"
            value={PRESETS.find((item) => item.provider === value.provider && item.baseUrl === value.baseUrl)?.id || 'custom'}
            onChange={(event) => {
              const preset = PRESETS.find((item) => item.id === event.target.value);
              if (preset) {
                onChange({
                  provider: preset.provider,
                  baseUrl: preset.baseUrl,
                  model: preset.model
                });
              }
            }}
          >
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </div>
        <div className="settings-field">
          <div className="settings-label">协议</div>
          <select
            className="settings-input"
            value={value.provider}
            onChange={(event) =>
              onChange({ provider: event.target.value as AppSettings['image']['provider'] })
            }
          >
            <option value="openai">OpenAI 兼容 /images/generations</option>
            <option value="a1111">SD WebUI /sdapi/v1/txt2img</option>
            <option value="comfyui">ComfyUI /prompt</option>
          </select>
        </div>
      </div>
      <div className="settings-label">服务地址</div>
      <input
        className="settings-input"
        value={value.baseUrl}
        spellCheck={false}
        onChange={(event) => onChange({ baseUrl: event.target.value })}
      />
      {value.provider === 'openai' && (
        <>
          <div className="settings-label">模型</div>
          <input
            className="settings-input"
            value={value.model}
            spellCheck={false}
            placeholder="gpt-image-1 / Kwai-Kolors/Kolors"
            onChange={(event) => onChange({ model: event.target.value })}
          />
          <div className="settings-label">API Key</div>
          <input
            className="settings-input"
            type="password"
            value={value.apiKey}
            placeholder="本地服务可留空"
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
          <div className="settings-label">尺寸</div>
          <input
            className="settings-input"
            value={value.size}
            spellCheck={false}
            placeholder="1024x1024"
            onChange={(event) => onChange({ size: event.target.value })}
          />
        </>
      )}
      {value.provider === 'a1111' && (
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">尺寸</div>
            <input
              className="settings-input"
              value={value.size}
              onChange={(event) => onChange({ size: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">步数</div>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={80}
              value={value.steps}
              onChange={(event) => onChange({ steps: Number(event.target.value) })}
            />
          </div>
        </div>
      )}
      {value.provider === 'comfyui' && (
        <>
          <div className="settings-label">ComfyUI API 工作流（JSON）</div>
          <textarea
            className="settings-input"
            rows={8}
            value={value.workflow}
            spellCheck={false}
            placeholder='把「保存（API 格式）」的工作流 JSON 贴进来，并在正向提示词节点里写 __PROMPT__'
            onChange={(event) => onChange({ workflow: event.target.value })}
          />
        </>
      )}
      <div className="settings-label">试生成</div>
      <div className="settings-inline">
        <input
          className="settings-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述想生成的图片"
        />
        <button className="mini-btn" disabled={busy || !value.enabled} onClick={() => void generate()}>
          {busy ? <Loader2 size={12} className="spin" /> : <Image size={12} />}
          生成
        </button>
      </div>
      {notice && <div className="settings-hint">{notice}</div>}
      {result && <img className="image-gen-result" src={result} alt="生成结果" />}
    </SettingsSection>
  );
}
