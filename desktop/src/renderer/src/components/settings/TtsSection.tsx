import { useEffect, useRef, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import type { TtsSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';
import { stopSpeech } from '../../lib/speech';

interface Props {
  value: TtsSettings;
  onChange: (patch: Partial<TtsSettings>) => void;
}

const SAMPLE = '这是一段朗读测试：拾字可以把字幕、总结和回答读出来。';

/** 这些平台都提供 OpenAI 兼容的 /audio/speech，只是地址/模型不同。 */
const OPENAI_TTS_PRESETS = [
  { id: 'openai', label: 'OpenAI（官方）', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy' },
  { id: 'siliconflow', label: '硅基流动 CosyVoice', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'alloy' },
  { id: 'localai', label: 'LocalAI（本地）', baseUrl: 'http://127.0.0.1:8080/v1', model: 'tts-1', voice: 'alloy' },
  { id: 'kokoro', label: 'Kokoro（本地）', baseUrl: 'http://127.0.0.1:8880/v1', model: 'kokoro', voice: 'af_heart' },
  { id: 'wavhost', label: 'Wavhost（本地）', baseUrl: 'http://127.0.0.1:8000/v1', model: 'kokoro', voice: 'af_heart' }
] as const;

/** 文字朗读：edge（在线）/ Windows SAPI（离线）/ OpenAI 兼容 TTS。 */
export function TtsSection({ value, onChange }: Props) {
  const [voices, setVoices] = useState<{ edge: Array<{ id: string; label: string }>; sapi: string[] }>(
    { edge: [], sapi: [] }
  );
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewToken = useRef(0);

  useEffect(() => {
    void window.bsub.ttsVoices().then((response) => {
      if (response.ok) setVoices(response.data);
    });
  }, []);

  useEffect(() => () => audio?.pause(), [audio]);

  const stopPreview = () => {
    previewToken.current += 1;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setAudio(null);
    setPreviewing(false);
  };

  const test = async () => {
    const token = (previewToken.current += 1);
    stopSpeech();
    setTesting(true);
    setNotice('');
    try {
      const response = await window.bsub.ttsSpeak({ text: SAMPLE, override: value });
      if (token !== previewToken.current) return;
      if (!response.ok) {
        setNotice(`朗读失败：${response.error}`);
        return;
      }
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      const player = new Audio(response.data.dataUrl);
      player.onended = () => {
        if (token === previewToken.current) setPreviewing(false);
      };
      setAudio(player);
      await player.play();
      if (token !== previewToken.current) {
        player.pause();
        return;
      }
      setPreviewing(true);
      setNotice(`使用 ${response.data.engine} 合成，用时 ${response.data.ms}ms`);
    } catch (error) {
      if (token === previewToken.current) setNotice(`播放失败：${(error as Error).message}`);
    } finally {
      if (token === previewToken.current) setTesting(false);
    }
  };

  const voiceOptions =
    value.engine === 'edge'
      ? voices.edge.map((voice) => ({ id: voice.id, label: voice.label }))
      : value.engine === 'sapi'
        ? voices.sapi.map((name) => ({ id: name, label: name }))
        : [];

  return (
    <SettingsSection title="文字朗读" defaultOpen={false}>
      <div className="settings-hint">
        朗读总结、对话回答和选中的文字。edge 免费且中文自然；SAPI 完全离线；OpenAI 音质最好但按量计费。
        Edge 接口如果被网络或地区拦截，会自动退回系统语音（10 分钟内不再重试）。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用文字朗读
      </label>

      <div className="settings-inline">
        <select
          className="settings-input"
          value={value.engine}
          onChange={(event) =>
            onChange({
              engine: event.target.value as TtsSettings['engine'],
              voice:
                event.target.value === 'edge'
                  ? 'zh-CN-XiaoxiaoNeural'
                  : event.target.value === 'openai'
                    ? 'alloy'
                    : ''
            })
          }
        >
          <option value="edge">Edge 在线（推荐）</option>
          <option value="sapi">Windows 系统语音（离线）</option>
          <option value="openai">OpenAI 兼容 TTS</option>
        </select>
        {value.engine !== 'openai' ? (
          <select
            className="settings-input"
            value={value.voice}
            onChange={(event) => onChange({ voice: event.target.value })}
          >
            {value.engine === 'sapi' && !voiceOptions.some((item) => item.id === value.voice) && (
              <option value={value.voice}>{value.voice || '系统默认音色'}</option>
            )}
            {voiceOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="settings-input"
            value={value.openai.voice}
            placeholder="alloy"
            onChange={(event) =>
              onChange({ openai: { ...value.openai, voice: event.target.value } })
            }
          />
        )}
      </div>

      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">语速（{value.rate.toFixed(1)}×）</div>
          <input
            className="settings-input"
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={value.rate}
            onChange={(event) => onChange({ rate: Number(event.target.value) })}
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">音量（{value.volume}%）</div>
          <input
            className="settings-input"
            type="range"
            min={0}
            max={100}
            step={5}
            value={value.volume}
            onChange={(event) => onChange({ volume: Number(event.target.value) })}
          />
        </div>
      </div>

      {value.engine === 'openai' && (
        <div className="settings-group">
          <div className="settings-group-title">OpenAI 兼容 TTS</div>
          <div className="settings-label">服务预设</div>
          <select
            className="settings-input"
            value={
              OPENAI_TTS_PRESETS.find(
                (preset) =>
                  preset.baseUrl === value.openai.baseUrl && preset.model === value.openai.model
              )?.id || 'custom'
            }
            onChange={(event) => {
              const preset = OPENAI_TTS_PRESETS.find((item) => item.id === event.target.value);
              if (preset) {
                onChange({
                  openai: {
                    ...value.openai,
                    baseUrl: preset.baseUrl,
                    model: preset.model,
                    voice: preset.voice
                  }
                });
              }
            }}
          >
            {OPENAI_TTS_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
          <div className="settings-label">接口地址</div>
          <input
            className="settings-input"
            value={value.openai.baseUrl}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            onChange={(event) =>
              onChange({ openai: { ...value.openai, baseUrl: event.target.value } })
            }
          />
          <div className="settings-label">模型</div>
          <input
            className="settings-input"
            value={value.openai.model}
            placeholder="gpt-4o-mini-tts / tts-1"
            spellCheck={false}
            onChange={(event) =>
              onChange({ openai: { ...value.openai, model: event.target.value } })
            }
          />
          <div className="settings-label">API Key</div>
          <input
            className="settings-input"
            type="password"
            value={value.openai.apiKey === '__CLEAR__' ? '' : value.openai.apiKey}
            placeholder="留空保存不改动"
            autoComplete="off"
            onChange={(event) =>
              onChange({ openai: { ...value.openai, apiKey: event.target.value } })
            }
          />
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">自动朗读</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.autoRead.chat}
            onChange={(event) =>
              onChange({ autoRead: { ...value.autoRead, chat: event.target.checked } })
            }
          />
          对话回答生成后自动朗读
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.autoRead.summary}
            onChange={(event) =>
              onChange({ autoRead: { ...value.autoRead, summary: event.target.checked } })
            }
          />
          总结生成后自动朗读
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.autoRead.note}
            onChange={(event) =>
              onChange({ autoRead: { ...value.autoRead, note: event.target.checked } })
            }
          />
          朗读笔记时使用同一套音色
        </label>
      </div>

      <div className="settings-inline">
        <button className="mini-btn" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={12} className="spin" /> : <Volume2 size={12} />}
          试听
        </button>
        {previewing && (
          <button className="mini-btn" onClick={stopPreview}>
            停止试听
          </button>
        )}
        {notice && <span className="settings-hint">{notice}</span>}
      </div>
    </SettingsSection>
  );
}
