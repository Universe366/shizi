import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppSettings, AsrDownloadProgress, AsrLocalStatus, AsrPlatform } from '../../../../shared/types';
import { ModelChips, SettingsSection } from './SettingsSection';

interface AsrSectionProps {
  draft: AppSettings;
  activeAsr: AsrPlatform | null;
  updateAsr: (patch: Partial<AppSettings['asr']>) => void;
  updateAsrPlatform: (patch: Partial<AsrPlatform>) => void;
  addAsrPlatform: () => void;
  removeAsrPlatform: () => void;
  testConnection: (kind: 'ai' | 'asr' | 'search') => void;
  probeModels: (kind: 'ai' | 'asr') => void;
  platformBusy: string;
  modelCache: Record<string, string[]>;
  showKey: Record<string, boolean>;
  setShowKey: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  setEditingAsrId: (id: string) => void;
  platformStatus: (kind: 'ai' | 'asr' | 'search') => ReactNode;
}

/** 语音识别：平台/协议、Key、模型探测、切片与并发等转录参数。 */
export function AsrSection({
  draft,
  activeAsr,
  updateAsr,
  updateAsrPlatform,
  addAsrPlatform,
  removeAsrPlatform,
  testConnection,
  probeModels,
  platformBusy,
  modelCache,
  showKey,
  setShowKey,
  setEditingAsrId,
  platformStatus
}: AsrSectionProps) {
  const [localStatus, setLocalStatus] = useState<AsrLocalStatus | null>(null);
  const [download, setDownload] = useState<AsrDownloadProgress | null>(null);
  const [modelChoice, setModelChoice] = useState<'tiny' | 'base' | 'small'>('base');

  const refreshStatus = () => {
    void window.bsub?.localAsrStatus?.().then((response) => {
      if (response?.ok) setLocalStatus(response.data);
    });
  };

  useEffect(() => {
    refreshStatus();
    return window.bsub?.onAsrDownloadProgress?.((progress) => {
      setDownload(progress);
      if (progress.percent >= 100) refreshStatus();
    });
  }, []);

  if (!activeAsr) return null;
  const isLocal = activeAsr.kind === 'local-whisper';
  const hasLocal = draft.asr.platforms.some((platform) => platform.kind === 'local-whisper');
  const pickPath = async (field: 'localExe' | 'localModel') => {
    const response = await window.bsub.pickFile?.({
      title: field === 'localExe' ? '选择 whisper-cli.exe' : '选择 ggml 模型文件',
      filters:
        field === 'localExe'
          ? [{ name: '可执行文件', extensions: ['exe'] }]
          : [{ name: 'whisper.cpp 模型', extensions: ['bin'] }]
    });
    if (response?.ok && response.data) updateAsrPlatform({ [field]: response.data });
  };
  const addLocalPlatform = () => {
    updateAsr({
      activeId: 'local-whisper',
      platforms: [
        ...draft.asr.platforms,
        {
          id: 'local-whisper',
          name: '本地 Whisper（whisper.cpp）',
          kind: 'local-whisper',
          baseUrl: '',
          apiKey: '',
          model: '',
          models: [],
          homepage: 'https://github.com/ggml-org/whisper.cpp/releases',
          keyUrl: 'https://huggingface.co/ggerganov/whisper.cpp/tree/main',
          localExe: '',
          localModel: ''
        }
      ]
    });
  };

  const startDownload = async (kind: 'model' | 'binary') => {
    const response =
      kind === 'model'
        ? await window.bsub.downloadAsrModel?.(modelChoice)
        : await window.bsub.downloadAsrBinary?.();
    if (!response) return;
    if (!response.ok) {
      setDownload({
        key: kind === 'model' ? `model:${modelChoice}` : 'binary',
        percent: 0,
        received: 0,
        total: 0,
        message: response.error
      });
      return;
    }
    if (kind === 'model') updateAsrPlatform({ localModel: response.data.path });
    else updateAsrPlatform({ localExe: response.data.path });
    setDownload(null);
    refreshStatus();
  };

  return (
<SettingsSection title="语音识别（ASR）" defaultOpen={false}>
  <div className="settings-hint">
    视频没有字幕时，用这里把音频转成文字。默认平台已能用；只有换服务或改额度时才需要动这些设置。
  </div>

  <div className="settings-group">
    <div className="settings-group-title">使用哪个平台</div>
    <div className="settings-inline">
      <select
        className="settings-input"
        value={activeAsr?.id || ''}
        onChange={(event) => setEditingAsrId(event.target.value)}
      >
        {draft.asr.platforms.map((platform) => (
          <option key={platform.id} value={platform.id}>
            {platform.name}
            {platform.id === draft.asr.activeId ? '（使用中）' : ''}
            {platform.kind !== 'local-whisper' && !platform.apiKey ? ' · 未配 Key' : ''}
          </option>
        ))}
      </select>
      {activeAsr && activeAsr.id !== draft.asr.activeId && (
        <button
          className="mini-btn primary"
          onClick={() => updateAsr({ activeId: activeAsr.id })}
        >
          设为使用中
        </button>
      )}
      <button className="mini-btn" title="新增平台" onClick={addAsrPlatform}>
        <Plus size={12} />
      </button>
      <button
        className="mini-btn"
        title="删除当前平台"
        disabled={draft.asr.platforms.length <= 1}
        onClick={removeAsrPlatform}
      >
        <Trash2 size={12} />
      </button>
    </div>
    {activeAsr.id !== draft.asr.activeId && (
      <div className="settings-hint">
        正在编辑「{activeAsr.name}」；点「设为使用中」后，转写才会用它。
      </div>
    )}
    {!hasLocal && (
      <div className="settings-inline">
        <button className="mini-btn" onClick={addLocalPlatform}>
          添加本地 Whisper 平台（离线转写）
        </button>
      </div>
    )}
  </div>

  <div className="settings-group">
    <div className="settings-group-title">连接信息</div>
    {isLocal ? (
      <>
        <div className="settings-group-desc">
          音频只在本机处理，不会上传到任何平台。需要先下载 whisper.cpp 和模型文件。
        </div>
        <div className="settings-label">平台名称</div>
        <input
          className="settings-input"
          value={activeAsr.name}
          onChange={(event) => updateAsrPlatform({ name: event.target.value })}
        />
        <div className="settings-label">whisper.cpp 可执行文件</div>
        <div className="settings-inline">
          <input
            className="settings-input"
            value={activeAsr.localExe || ''}
            placeholder="D:\\whisper\\whisper-cli.exe"
            spellCheck={false}
            onChange={(event) => updateAsrPlatform({ localExe: event.target.value })}
          />
          <button className="mini-btn" onClick={() => void pickPath('localExe')}>
            选择…
          </button>
        </div>
        <div className="settings-label">模型文件（ggml-*.bin）</div>
        <div className="settings-inline">
          <input
            className="settings-input"
            value={activeAsr.localModel || ''}
            placeholder="D:\\whisper\\ggml-base.bin"
            spellCheck={false}
            onChange={(event) => updateAsrPlatform({ localModel: event.target.value })}
          />
          <button className="mini-btn" onClick={() => void pickPath('localModel')}>
            选择…
          </button>
        </div>
        <div className="settings-label">一键下载（存到程序数据目录，离线可用）</div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={modelChoice}
            onChange={(event) => setModelChoice(event.target.value as 'tiny' | 'base' | 'small')}
          >
            <option value="tiny">tiny（约 74MB，最快）</option>
            <option value="base">base（约 141MB，推荐）</option>
            <option value="small">small（约 465MB，更准）</option>
          </select>
          <button
            className="mini-btn primary"
            disabled={Boolean(download)}
            onClick={() => void startDownload('model')}
          >
            下载模型
          </button>
          <button
            className="mini-btn"
            disabled={Boolean(download)}
            onClick={() => void startDownload('binary')}
          >
            下载 whisper.cpp
          </button>
          {download && download.percent > 0 && download.percent < 100 && (
            <button
              className="mini-btn"
              onClick={() => {
                window.bsub.cancelAsrDownload?.(download?.key ?? '');
                setDownload(null);
              }}
            >
              取消
            </button>
          )}
        </div>
        {download && (
          <div className="settings-hint">
            {download.message}
            {download.total > 0
              ? ` · ${Math.round(download.received / 1024 / 1024)} / ${Math.round(
                  download.total / 1024 / 1024
                )} MB`
              : ''}
          </div>
        )}
        <div className="settings-hint">
          已就绪：
          {localStatus?.binary ? ' whisper.cpp ✓' : ' whisper.cpp 未下载'}
          {localStatus?.models?.tiny ? ' · tiny ✓' : ''}
          {localStatus?.models?.base ? ' · base ✓' : ''}
          {localStatus?.models?.small ? ' · small ✓' : ''}
        </div>
        <div className="settings-inline">
          <button
            className="mini-btn primary"
            disabled={platformBusy === 'asr:test'}
            onClick={() => void testConnection('asr')}
          >
            {platformBusy === 'asr:test' ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Wifi size={12} />
            )}
            测试本地环境
          </button>
          <button
            className="mini-btn"
            onClick={() => void window.bsub.newTab(activeAsr.homepage || 'https://github.com/ggml-org/whisper.cpp/releases')}
          >
            手动下载 whisper.cpp
          </button>
          <button
            className="mini-btn"
            onClick={() =>
              void window.bsub.newTab(
                activeAsr.keyUrl || 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
              )
            }
          >
            手动下载模型
          </button>
        </div>
        {platformStatus('asr')}
        <div className="settings-hint">
          一键下载会写入程序数据目录，并校验 SHA-256；下载完成后自动填好上面的路径。
          手动下载时，把 exe 和 bin 解压到同一个目录，再用「选择…」指过来即可。
        </div>
      </>
    ) : (
      <>
        <div className="settings-group-desc">地址和模型名按平台文档填写；不确定时先点「测试连接」。</div>

        <div className="settings-label">平台名称</div>
        <input
          className="settings-input"
          value={activeAsr.name}
          onChange={(event) => updateAsrPlatform({ name: event.target.value })}
        />

        <div className="settings-label">接口地址（Base URL）</div>
        <input
          className="settings-input"
          value={activeAsr.baseUrl}
          spellCheck={false}
          onChange={(event) => updateAsrPlatform({ baseUrl: event.target.value })}
        />

        <div className="settings-label">模型</div>
        <input
          className="settings-input"
          list={`asr-models-${activeAsr.id}`}
          value={activeAsr.model}
          spellCheck={false}
          onChange={(event) => updateAsrPlatform({ model: event.target.value })}
        />
        <datalist id={`asr-models-${activeAsr.id}`}>
          {(modelCache[activeAsr.id] || activeAsr.models || []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>

        <div className="settings-label">API Key</div>
        <div className="settings-inline">
          <input
            className="settings-input"
            type={showKey[activeAsr.id] ? 'text' : 'password'}
            value={activeAsr.apiKey === '__CLEAR__' ? '' : activeAsr.apiKey}
            placeholder="留空保存不改动"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => updateAsrPlatform({ apiKey: event.target.value })}
          />
          <button
            className="mini-btn"
            onClick={() =>
              setShowKey((previous) => ({ ...previous, [activeAsr.id]: !previous[activeAsr.id] }))
            }
          >
            {showKey[activeAsr.id] ? '隐藏' : '显示'}
          </button>
          <button
            className="mini-btn"
            onClick={() => updateAsrPlatform({ apiKey: '__CLEAR__' })}
          >
            清除
          </button>
        </div>

        <div className="settings-inline">
          <button
            className="mini-btn primary"
            disabled={platformBusy === 'asr:test'}
            onClick={() => void testConnection('asr')}
          >
            {platformBusy === 'asr:test' ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Wifi size={12} />
            )}
            测试连接
          </button>
          <button
            className="mini-btn"
            disabled={platformBusy === 'asr:probe'}
            title="调用平台接口，拉取当前账号可用的模型列表"
            onClick={() => void probeModels('asr')}
          >
            {platformBusy === 'asr:probe' ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            获取模型列表
          </button>
          {activeAsr.homepage && (
            <button
              className="mini-btn"
              onClick={() => void window.bsub.newTab(activeAsr.homepage!)}
            >
              官网
            </button>
          )}
          {activeAsr.keyUrl && (
            <button
              className="mini-btn"
              onClick={() => void window.bsub.newTab(activeAsr.keyUrl!)}
            >
              获取 Key
            </button>
          )}
        </div>
        {platformStatus('asr')}
        <ModelChips
          key={activeAsr.id}
          models={modelCache[activeAsr.id] || activeAsr.models || []}
          current={activeAsr.model}
          probed={Boolean(modelCache[activeAsr.id])}
          onPick={(model) => updateAsrPlatform({ model })}
        />

        <details className="settings-advanced">
          <summary>预设的官网 / 申请 Key 链接</summary>
          <div className="settings-label">官网地址</div>
          <input
            className="settings-input"
            value={activeAsr.homepage || ''}
            placeholder="https://"
            onChange={(event) => updateAsrPlatform({ homepage: event.target.value })}
          />
          <div className="settings-label">申请 Key 链接</div>
          <input
            className="settings-input"
            value={activeAsr.keyUrl || ''}
            placeholder="https://"
            onChange={(event) => updateAsrPlatform({ keyUrl: event.target.value })}
          />
        </details>
      </>
    )}
  </div>

  <div className="settings-group">
    <div className="settings-group-title">识别设置</div>
    <div className="settings-group-desc">
      {isLocal
        ? '本地识别用 CPU；线程数不超过物理核心数即可。'
        : '一般保持「自动」即可；长视频可以把切片调大，减少请求数。'}
    </div>

    <div className="settings-inline">
      <div className="settings-field">
        <div className="settings-label">语言</div>
        <select
          className="settings-input"
          value={draft.asr.language}
          onChange={(event) => updateAsr({ language: event.target.value })}
        >
          <option value="auto">自动</option>
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="ja">日文</option>
        </select>
      </div>
      {isLocal ? (
        <div className="settings-field">
          <div className="settings-label">线程数</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={32}
            value={draft.asr.localThreads || 4}
            onChange={(event) =>
              updateAsr({ localThreads: Math.min(32, Math.max(1, Number(event.target.value) || 4)) })
            }
          />
        </div>
      ) : (
        <div className="settings-field">
          <div className="settings-label">音频格式</div>
          <select
            className="settings-input"
            value={draft.asr.audioFormat}
            onChange={(event) =>
              updateAsr({ audioFormat: event.target.value as AppSettings['asr']['audioFormat'] })
            }
          >
            <option value="auto">自动</option>
            <option value="m4a">M4A</option>
            <option value="wav">WAV</option>
          </select>
        </div>
      )}
    </div>

    {!isLocal && (
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">切片（秒）</div>
          <input
            className="settings-input"
            type="number"
            min={30}
            max={300}
            value={draft.asr.chunkSeconds}
            onChange={(event) => updateAsr({ chunkSeconds: Number(event.target.value) || 120 })}
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">并发</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={8}
            value={draft.asr.concurrency}
            onChange={(event) => updateAsr({ concurrency: Number(event.target.value) || 1 })}
          />
        </div>
      </div>
    )}
  </div>

  {!isLocal && (
    <details className="settings-advanced">
      <summary>高级设置</summary>
      <div className="settings-hint">
        平台里的值优先；留「自动」时才用下面的默认值。改错会直接导致转写失败，不确定就保持默认。
      </div>

      <div className="settings-group-title">该平台的请求细节</div>
      <div className="settings-label">请求方式</div>
      <select
        className="settings-input"
        value={activeAsr.transport || 'multipart'}
        onChange={(event) =>
          updateAsrPlatform({ transport: event.target.value as AsrPlatform['transport'] })
        }
      >
        <option value="multipart">multipart/form-data</option>
        <option value="base64-json">base64 JSON</option>
        <option value="chat-audio">chat/audio（input_audio）</option>
        <option value="auto">自动</option>
      </select>
      <div className="settings-label">上传字段名</div>
      <input
        className="settings-input"
        value={activeAsr.keyField || 'file'}
        onChange={(event) => updateAsrPlatform({ keyField: event.target.value })}
      />
      <div className="settings-label">上传音频格式</div>
      <select
        className="settings-input"
        value={activeAsr.audioFormat || 'auto'}
        onChange={(event) =>
          updateAsrPlatform({ audioFormat: event.target.value as AsrPlatform['audioFormat'] })
        }
      >
        <option value="auto">自动</option>
        <option value="wav">WAV</option>
        <option value="m4a">M4A</option>
      </select>
      <div className="settings-label">参数风格</div>
      <select
        className="settings-input"
        value={activeAsr.paramStyle || 'auto'}
        onChange={(event) =>
          updateAsrPlatform({ paramStyle: event.target.value as AsrPlatform['paramStyle'] })
        }
      >
        <option value="auto">自动</option>
        <option value="minimal">最小（file + model）</option>
        <option value="full">完整（response_format 等）</option>
      </select>

      <div className="settings-group-title">默认参数（上面没指定时使用）</div>
      <div className="settings-label">默认传输方式</div>
      <select
        className="settings-input"
        value={draft.asr.transport}
        onChange={(event) =>
          updateAsr({ transport: event.target.value as AppSettings['asr']['transport'] })
        }
      >
        <option value="auto">自动（失败自动换一种）</option>
        <option value="multipart">multipart /audio/transcriptions</option>
        <option value="base64-json">base64 JSON</option>
        <option value="chat-audio">chat + input_audio</option>
      </select>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">单请求超时（秒）</div>
          <input
            className="settings-input"
            type="number"
            min={30}
            max={1800}
            value={draft.asr.timeoutSeconds}
            onChange={(event) =>
              updateAsr({ timeoutSeconds: Number(event.target.value) || 120 })
            }
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">单段上限（MB）</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={100}
            value={draft.asr.maxFileMb}
            onChange={(event) => updateAsr({ maxFileMb: Number(event.target.value) || 20 })}
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">重叠切片（秒）</div>
          <input
            className="settings-input"
            type="number"
            min={0}
            max={30}
            value={draft.asr.overlapSeconds}
            onChange={(event) => updateAsr({ overlapSeconds: Number(event.target.value) || 0 })}
          />
        </div>
      </div>
      <div className="settings-hint">
        SenseVoice 只吃 M4A；带时间戳的中文模型通常只吃 WAV。格式选「自动」会按模型判断。
      </div>
    </details>
  )}
</SettingsSection>
  );
}
