import { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  Cpu,
  Download,
  HardDrive,
  RefreshCw,
  Trash2
} from 'lucide-react';
import type {
  AsrDownloadProgress,
  AsrLocalStatus,
  AsrPlatform
} from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';
import { formatBytes } from '../../lib/format';

type ModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo';
type BinaryVariant = 'cpu' | 'vulkan' | 'cuda118' | 'cuda124';

interface Props {
  activeAsr: AsrPlatform | null;
  updateAsrPlatform: (patch: Partial<AsrPlatform>) => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return formatBytes(bytes);
}

/** 本地模型：whisper 模型与运行组件统一管理。 */
export function LocalModelsSection({ activeAsr, updateAsrPlatform }: Props) {
  const [status, setStatus] = useState<AsrLocalStatus | null>(null);
  const [progress, setProgress] = useState<AsrDownloadProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [gpuNames, setGpuNames] = useState<string[]>([]);
  const [recommended, setRecommended] = useState<BinaryVariant | ''>('');
  const refresh = useCallback(() => {
    void window.bsub?.localAsrStatus?.().then((response) => {
      if (response?.ok) setStatus(response.data);
    });
  }, []);

  useEffect(() => {
    refresh();
    return window.bsub?.onAsrDownloadProgress?.((event) => {
      setProgress(event);
      if (event.percent >= 100) refresh();
    });
  }, [refresh]);
  const localActive = activeAsr?.kind === 'local-whisper' ? activeAsr : null;
  const currentModel = localActive?.localModel || '';
  const currentBinary = localActive?.localExe || '';

  const download = async (kind: 'model' | 'binary', id: ModelId | BinaryVariant) => {
    setNotice('');
    const key = kind === 'model' ? `model:${id}` : `binary:${id}`;
    setProgress({ key, percent: 0, received: 0, total: 0, message: '准备下载…' });
    const response =
      kind === 'model'
        ? await window.bsub.downloadAsrModel?.(id as ModelId)
        : await window.bsub.downloadAsrBinary?.(id as BinaryVariant);
    if (!response) return;
    if (!response.ok) {
      setProgress(null);
      setNotice(`下载失败：${response.error}`);
      return;
    }
    setProgress(null);
    refresh();
    setNotice(`已下载：${response.data.path}`);
  };

  const removeModel = async (id: ModelId, modelPath: string) => {
    if (modelPath && currentModel === modelPath) {
      setNotice('当前转写正在使用这个模型；先在「语音识别」里换一个模型或取消本地平台。');
      return;
    }
    const response = await window.bsub.deleteAsrModel?.(id);
    if (response?.ok) {
      setStatus(response.data.status);
      setNotice(response.data.removed ? '模型已删除。' : '没有找到模型文件。');
    } else {
      setNotice(`删除失败：${response?.error || '未知错误'}`);
    }
  };

  const removeBinary = async (variant: BinaryVariant, exePath: string) => {
    if (exePath && currentBinary === exePath) {
      setNotice('当前转写正在使用这个运行组件；先在「语音识别」里换一个构建。');
      return;
    }
    const response = await window.bsub.deleteAsrBinary?.(variant);
    if (response?.ok) {
      setStatus(response.data.status);
      setNotice(response.data.removed ? '运行组件已删除。' : '没有找到运行组件。');
    } else {
      setNotice(`删除失败：${response?.error || '未知错误'}`);
    }
  };

  const useModel = (modelPath: string, label: string) => {
    if (!localActive) {
      setNotice('先在「语音识别」里选中本地 Whisper 平台，再回来选用模型。');
      return;
    }
    updateAsrPlatform({ localModel: modelPath });
    setNotice(`已选用 ${label}（记得保存设置）。`);
  };

  const useBinary = (exePath: string, label: string) => {
    if (!localActive) {
      setNotice('先在「语音识别」里选中本地 Whisper 平台，再回来选用运行组件。');
      return;
    }
    updateAsrPlatform({ localExe: exePath });
    setNotice(`已选用 ${label}（记得保存设置）。`);
  };

  const detectGpu = async () => {
    const response = await window.bsub.detectGpu?.();
    if (!response?.ok) return;
    const names = response.data.names;
    setGpuNames(names);
    const text = names.join(' ').toLowerCase();
    const next: BinaryVariant = /nvidia|geforce|rtx|gtx|quadro/.test(text)
      ? 'cuda124'
      : /amd|radeon|intel|arc/.test(text)
        ? 'vulkan'
        : 'cpu';
    setRecommended(next);
    setNotice(`检测到 ${names.length ? names.join(' / ') : '未知显卡'}；推荐 ${next} 构建。`);
  };
  const activeDownload = progress && progress.percent < 100 ? progress : null;

  const models = status?.modelCatalog || [];
  const binaries = status?.binaryCatalog || [];
  const installedModels = models.filter((row) => row.downloaded).length;
  const installedBinaries = binaries.filter((row) => row.downloaded).length;

  return (
    <SettingsSection title="本地 Whisper 模型" defaultOpen={false}>
      <div className="settings-hint">
        语音识别的一键下载版：模型和 whisper.cpp 都存在用户数据目录，软件更新不会丢。
        下载会校验体积与 SHA-256，也可以删除不再用的模型腾空间。
      </div>

      <div className="local-model-metrics">
        <div className="local-model-metric">
          <div className="usage-card-label">已装语音模型</div>
          <div className="usage-card-value">
            {installedModels} <span className="local-model-unit">/ {models.length || 5}</span>
          </div>
        </div>
        <div className="local-model-metric">
          <div className="usage-card-label">已装运行组件</div>
          <div className="usage-card-value">
            {installedBinaries} <span className="local-model-unit">/ {binaries.length || 4}</span>
          </div>
        </div>
        <div className="local-model-metric">
          <div className="usage-card-label">占用空间</div>
          <div className="usage-card-value">{formatSize(status?.totalBytes || 0)}</div>
          <div className="usage-insight-helper" title={status?.dir || ''}>
            {status?.dir || '读取中…'}
          </div>
        </div>
      </div>

      <div className="settings-inline">
        <button className="mini-btn" onClick={refresh}>
          <RefreshCw size={12} /> 刷新状态
        </button>
        <button className="mini-btn" onClick={() => void window.bsub.openDataDir?.()}>
          <HardDrive size={12} /> 打开数据目录
        </button>
        <button className="mini-btn" onClick={() => void detectGpu()}>
          <Cpu size={12} /> 检测显卡
        </button>
        {gpuNames.length > 0 && (
          <span className="settings-hint">推荐：{recommended}（{gpuNames.join(' / ')}）</span>
        )}
      </div>

      <div className="settings-inline">
        <span className="settings-hint">手动下载：</span>
        <button
          className="mini-btn"
          onClick={() =>
            void window.bsub.newTab('https://github.com/ggml-org/whisper.cpp/releases')
          }
        >
          whisper.cpp
        </button>
        <button
          className="mini-btn"
          onClick={() =>
            void window.bsub.newTab(
              'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
            )
          }
        >
          模型文件
        </button>
      </div>

      {activeDownload && (
        <div className="local-model-progress">
          <span className="settings-hint">
            {activeDownload.message} · {activeDownload.percent}%
            {activeDownload.total > 0
              ? ` · ${formatSize(activeDownload.received)} / ${formatSize(activeDownload.total)}`
              : ''}
          </span>
          <button
            className="mini-btn"
            onClick={() => {
              window.bsub.cancelAsrDownload?.(activeDownload.key);
              setProgress(null);
            }}
          >
            取消
          </button>
        </div>
      )}

      {notice && <div className="settings-hint">{notice}</div>}

      {!localActive && (
        <div className="settings-hint">
          当前语音识别不是本地 Whisper：可以先在这里下载，再到「语音识别（ASR）」里添加本地平台并选用。
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">
          <Boxes size={12} /> 语音识别模型（whisper.cpp）
        </div>
        <div className="local-model-list">
          {models.map((model) => {
            const path = status?.models[model.id] || '';
            const busy = activeDownload?.key === `model:${model.id}`;
            const inUse = Boolean(path && currentModel === path);
            return (
              <div className="local-model-row" key={model.id}>
                <div className="local-model-main">
                  <div className="local-model-name">
                    {model.label}
                    {inUse && <span className="local-model-badge is-ready">使用中</span>}
                    {model.downloaded && !inUse && (
                      <span className="local-model-badge is-ready">已就绪</span>
                    )}
                    {!model.downloaded && model.partialBytes > 0 && (
                      <span className="local-model-badge is-warn">
                        未完成 {formatSize(model.partialBytes)}
                      </span>
                    )}
                    {!model.downloaded && model.partialBytes === 0 && (
                      <span className="local-model-badge">未下载</span>
                    )}
                  </div>
                  <div className="local-model-meta">{formatSize(model.size)}</div>
                </div>
                <div className="local-model-actions">
                  {model.downloaded ? (
                    <>
                      <button
                        className="mini-btn"
                        disabled={inUse || !localActive}
                        title={!localActive ? '先选中本地 Whisper 平台' : undefined}
                        onClick={() => useModel(path, model.label)}
                      >
                        选用
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => void removeModel(model.id, path)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="mini-btn primary"
                        disabled={Boolean(activeDownload)}
                        onClick={() => void download('model', model.id)}
                      >
                        <Download size={12} /> {busy ? '下载中' : model.partialBytes > 0 ? '继续下载' : '下载'}
                      </button>
                      {model.partialBytes > 0 && (
                        <button
                          className="mini-btn"
                          title="删除未完成的下载"
                          onClick={() => void removeModel(model.id, '')}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">
          <Cpu size={12} /> 运行组件（whisper.cpp 构建）
        </div>
        <div className="settings-group-sub">CPU 通用；AMD/Intel 用 Vulkan，NVIDIA 用 CUDA。选错会明显变慢或无法启动。</div>
        <div className="local-model-list">
          {binaries.map((binary) => {
            const exe = status?.binaries[binary.variant] || '';
            const inUse = Boolean(exe && currentBinary === exe);
            return (
              <div className="local-model-row" key={binary.variant}>
                <div className="local-model-main">
                  <div className="local-model-name">
                    {binary.label}
                    {inUse && <span className="local-model-badge is-ready">使用中</span>}
                    {binary.downloaded && !inUse && (
                      <span className="local-model-badge is-ready">已就绪</span>
                    )}
                    {!binary.downloaded && binary.partialBytes > 0 && (
                      <span className="local-model-badge is-warn">
                        未完成 {formatSize(binary.partialBytes)}
                      </span>
                    )}
                    {!binary.downloaded && recommended && binary.variant === recommended && (
                      <span className="local-model-badge is-warn">推荐</span>
                    )}
                  </div>
                  <div className="local-model-meta">
                    {formatSize(binary.size)} · {binary.note}
                  </div>
                </div>
                <div className="local-model-actions">
                  {binary.downloaded ? (
                    <>
                      <button
                        className="mini-btn"
                        disabled={inUse || !localActive}
                        title={!localActive ? '先选中本地 Whisper 平台' : undefined}
                        onClick={() => useBinary(exe, binary.label)}
                      >
                        选用
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => void removeBinary(binary.variant, exe)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="mini-btn primary"
                        disabled={Boolean(activeDownload)}
                        onClick={() => void download('binary', binary.variant)}
                      >
                        <Download size={12} /> {binary.partialBytes > 0 ? '继续下载' : '下载'}
                      </button>
                      {binary.partialBytes > 0 && (
                        <button
                          className="mini-btn"
                          title="删除未完成的下载"
                          onClick={() => void removeBinary(binary.variant, '')}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="settings-hint">
        模型下载与删除只影响本机的用户数据目录；正在使用的模型会被保护，先切换再删除。
      </div>
    </SettingsSection>
  );
}
