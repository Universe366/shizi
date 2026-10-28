import { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  Cpu,
  Database,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  ScanText,
  Trash2
} from 'lucide-react';
import type {
  AppSettings,
  AsrDownloadProgress,
  AsrLocalStatus,
  AsrPlatform,
  KbProgress,
  KbStatus,
  LocalEmbeddingStatus,
  OllamaPullProgress
} from '../../../../shared/types';
import { OLLAMA_EMBEDDING_CATALOG } from '../../../../shared/localModels';
import { SettingsSection } from './SettingsSection';
import { formatBytes } from '../../lib/format';

type ModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo';
type BinaryVariant = 'cpu' | 'vulkan' | 'cuda118' | 'cuda124';

interface Props {
  draft: AppSettings;
  activeAsr: AsrPlatform | null;
  updateAsrPlatform: (patch: Partial<AsrPlatform>) => void;
  /** 把本机 OpenAI 兼容服务设为知识库的 embedding 平台（必要时新建平台）。 */
  onUseLocalEmbedding: (baseUrl: string, model: string) => void;
  /** 把内置本地向量模型设为知识库 embedding。 */
  onUseBuiltinEmbedding: () => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return formatBytes(bytes);
}

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]/i.test(String(url || ''));
}

/** 本地模型：whisper 模型与运行组件统一管理，另列知识库向量/OCR 的本地能力状态。 */
export function LocalModelsSection({
  draft,
  activeAsr,
  updateAsrPlatform,
  onUseLocalEmbedding,
  onUseBuiltinEmbedding
}: Props) {
  const kbPlatform = draft.ai.platforms.find(
    (platform) => platform.id === (draft.knowledge.platformId || draft.ai.activeId)
  );
  const kbLocal = Boolean(kbPlatform && isLocalUrl(kbPlatform.baseUrl));
  const [status, setStatus] = useState<AsrLocalStatus | null>(null);
  const [progress, setProgress] = useState<AsrDownloadProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [gpuNames, setGpuNames] = useState<string[]>([]);
  const [recommended, setRecommended] = useState<BinaryVariant | ''>('');
  const [localBaseUrl, setLocalBaseUrl] = useState(() =>
    kbPlatform && isLocalUrl(kbPlatform.baseUrl)
      ? kbPlatform.baseUrl
      : 'http://127.0.0.1:11434/v1'
  );
  const [embeddingModel, setEmbeddingModel] = useState(() => draft.knowledge.model || '');
  const [probeModels, setProbeModels] = useState<string[] | null>(null);
  const [probeError, setProbeError] = useState('');
  const [probeBusy, setProbeBusy] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingTest, setEmbeddingTest] = useState('');
  const [pullModel, setPullModel] = useState<string>(OLLAMA_EMBEDDING_CATALOG[0].model);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<OllamaPullProgress | null>(null);
  const [kbStatus, setKbStatus] = useState<KbStatus | null>(null);
  const [kbProgress, setKbProgress] = useState<KbProgress | null>(null);
  const [buildingIndex, setBuildingIndex] = useState(false);
  const [builtinStatus, setBuiltinStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [builtinProgress, setBuiltinProgress] = useState<AsrDownloadProgress | null>(null);
  const [builtinBusy, setBuiltinBusy] = useState(false);
  const [builtinTest, setBuiltinTest] = useState('');

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

  const refreshBuiltin = useCallback(async () => {
    const response = await window.bsub.localEmbeddingStatus?.();
    if (response?.ok) setBuiltinStatus(response.data);
  }, []);

  useEffect(() => {
    void refreshBuiltin();
    return window.bsub.onLocalEmbeddingProgress?.((event) => {
      setBuiltinProgress(event);
      if (event.percent >= 100) {
        setBuiltinBusy(false);
        void refreshBuiltin();
      }
    });
  }, [refreshBuiltin]);

  const refreshKb = useCallback(async () => {
    const response = await window.bsub.kbStatus?.();
    if (response?.ok) setKbStatus(response.data);
  }, []);

  useEffect(() => {
    void refreshKb();
    return window.bsub.onKbProgress?.((event) => setKbProgress(event));
  }, [refreshKb]);

  useEffect(() => {
    return window.bsub?.onOllamaPullProgress?.((event) => {
      setPullProgress(event);
      if (event.percent >= 100) {
        setPulling(false);
        setNotice(`已拉取 ${event.model}；点「检测服务」刷新模型列表`);
      }
    });
  }, []);

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

  const probeLocalService = async () => {
    setProbeBusy(true);
    setProbeError('');
    setEmbeddingTest('');
    setProbeModels(null);
    try {
      const response = await window.bsub.probePlatformModels?.('ai', {
        id: 'local-embedding-probe',
        name: '本地向量服务',
        baseUrl: localBaseUrl.trim(),
        apiKey: '',
        model: ''
      });
      if (!response) {
        setProbeError('当前版本不支持检测本地服务');
        return;
      }
      if (!response.ok) {
        setProbeError(`连接失败：${response.error}`);
        return;
      }
      const models = response.data.models || [];
      setProbeModels(models);
      const preferred =
        models.find((name) => /embed|bge|gte|nomic|e5|m3/i.test(name)) || models[0] || '';
      if (preferred) setEmbeddingModel(preferred);
      if (!models.length) {
        setProbeError('服务已连接，但没有返回模型；先在本地服务里拉取 embedding 模型。');
      }
    } catch (error) {
      setProbeError(`连接失败：${(error as Error).message}`);
    } finally {
      setProbeBusy(false);
    }
  };

  const testEmbedding = async () => {
    setTestingEmbedding(true);
    setEmbeddingTest('');
    setProbeError('');
    try {
      const response = await window.bsub.testLocalEmbedding?.({
        baseUrl: localBaseUrl.trim(),
        model: embeddingModel
      });
      if (!response) {
        setProbeError('当前版本不支持测试 embedding');
        return;
      }
      if (!response.ok) {
        setProbeError(`测试失败：${response.error}`);
        return;
      }
      setEmbeddingTest(
        `可用 · ${response.data.dimensions} 维 · ${response.data.latencyMs}ms`
      );
    } finally {
      setTestingEmbedding(false);
    }
  };

  const pullModelNow = async () => {
    const model = pullModel.trim();
    if (!model) {
      setProbeError('先选择或填写模型名');
      return;
    }
    setPulling(true);
    setProbeError('');
    setPullProgress({ model, percent: 0, status: '准备拉取…' });
    try {
      const response = await window.bsub.pullOllamaEmbedding?.({
        baseUrl: localBaseUrl.trim(),
        model
      });
      if (!response) {
        setProbeError('当前版本不支持拉取模型');
        setPullProgress(null);
        return;
      }
      if (!response.ok) {
        setProbeError(`拉取失败：${response.error}`);
        setPullProgress(null);
        return;
      }
      setNotice(`已拉取 ${model}；点「检测服务」刷新模型列表`);
      setPullProgress(null);
    } catch (error) {
      setProbeError(`拉取失败：${(error as Error).message}`);
      setPullProgress(null);
    } finally {
      setPulling(false);
    }
  };

  const downloadBuiltin = async () => {
    setBuiltinBusy(true);
    setProbeError('');
    setBuiltinTest('');
    setBuiltinProgress({ key: 'builtin', percent: 0, received: 0, total: 0, message: '准备下载…' });
    try {
      const response = await window.bsub.downloadLocalEmbedding?.();
      if (!response) {
        setProbeError('当前版本不支持内置向量模型');
        setBuiltinProgress(null);
        return;
      }
      if (!response.ok) {
        setProbeError(`下载失败：${response.error}`);
        setBuiltinProgress(null);
        return;
      }
      setBuiltinStatus(response.data);
      setBuiltinProgress(null);
      setNotice('内置向量模型已下载');
    } catch (error) {
      setProbeError(`下载失败：${(error as Error).message}`);
      setBuiltinProgress(null);
    } finally {
      setBuiltinBusy(false);
    }
  };

  const removeBuiltin = async () => {
    const response = await window.bsub.removeLocalEmbedding?.();
    if (!response) return;
    if (!response.ok) {
      setProbeError(`删除失败：${response.error}`);
      return;
    }
    setBuiltinStatus(response.data.status);
    setBuiltinTest('');
    setNotice(response.data.removed ? '已删除内置向量模型' : '没有可删除的模型');
  };

  const testBuiltin = async () => {
    setBuiltinBusy(true);
    setBuiltinTest('');
    setProbeError('');
    try {
      const response = await window.bsub.testLocalEmbeddingBuiltin?.();
      if (!response) {
        setProbeError('当前版本不支持测试内置向量模型');
        return;
      }
      if (!response.ok) {
        setProbeError(`测试失败：${response.error}`);
        return;
      }
      setBuiltinTest(`可用 · ${response.data.dimensions} 维 · ${response.data.latencyMs}ms`);
    } finally {
      setBuiltinBusy(false);
    }
  };

  const useBuiltin = () => {
    onUseBuiltinEmbedding();
    setNotice('已设为知识库 embedding：内置 bge-small-zh-v1.5（先保存设置，再构建索引）');
  };

  const useEmbedding = () => {
    const model = embeddingModel.trim();
    if (!model) {
      setProbeError('先检测服务并选择一个 embedding 模型');
      return;
    }
    if (!/^https?:\/\//i.test(localBaseUrl.trim())) {
      setProbeError('服务地址要以 http:// 或 https:// 开头');
      return;
    }
    onUseLocalEmbedding(localBaseUrl.trim(), model);
    setNotice(`已设为知识库 embedding：${model}（先保存设置，再构建索引）`);
  };

  const buildIndex = async () => {
    if (buildingIndex) return;
    if (!draft.knowledge.enabled) {
      setProbeError('先启用知识库（设置 → 检索与知识 → 知识库）');
      return;
    }
    setBuildingIndex(true);
    setProbeError('');
    setKbProgress({ phase: 'collect', done: 0, total: 1, message: '准备索引…' });
    try {
      const response = await window.bsub.kbIndex?.();
      if (!response) {
        setProbeError('当前版本不支持构建索引');
        return;
      }
      if (!response.ok) {
        setProbeError(`构建索引失败：${response.error}`);
        return;
      }
      setKbStatus(response.data);
      setNotice(
        `索引完成：${response.data.chunks} 块 / ${response.data.videos} 个视频`
      );
    } catch (error) {
      setProbeError(`构建索引失败：${(error as Error).message}`);
    } finally {
      setBuildingIndex(false);
      setKbProgress(null);
    }
  };

  const activeDownload = progress && progress.percent < 100 ? progress : null;

  const models = status?.modelCatalog || [];
  const binaries = status?.binaryCatalog || [];
  const installedModels = models.filter((row) => row.downloaded).length;
  const installedBinaries = binaries.filter((row) => row.downloaded).length;

  const kbText = kbPlatform
    ? `${kbPlatform.name} · ${draft.knowledge.model || '未填模型'}`
    : '没有可用平台';
  const ocrText =
    draft.ocr.engine === 'paddle'
      ? `PaddleOCR 服务 · ${draft.ocr.paddleUrl || '未填地址'}`
      : 'Windows 系统 OCR · 离线免下载';
  const ocrLocal = draft.ocr.engine !== 'paddle' || isLocalUrl(draft.ocr.paddleUrl);
  const filteredModels = (probeModels || []).filter((name) =>
    /embed|bge|gte|nomic|e5|m3/i.test(name)
  );
  const visibleModels =
    showAllModels || !filteredModels.length ? probeModels || [] : filteredModels;

  return (
    <SettingsSection title="本地模型管理" defaultOpen={false}>
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

      <div className="settings-group">
        <div className="settings-group-title">
          <Cpu size={12} /> 内置向量模型（离线）
        </div>
        <div className="settings-group-sub">
          bge-small-zh-v1.5 · 512 维 · 约 24MB；由 onnxruntime 在本机推理，不联网、不需要 Key。
        </div>
        <div className="local-model-row">
          <div className="local-model-main">
            <div className="local-model-name">
              内置向量模型
              {draft.knowledge.provider === 'local' && (
                <span className="local-model-badge is-ready">使用中</span>
              )}
              {builtinStatus?.installed ? (
                <span className="local-model-badge is-ready">已就绪</span>
              ) : (
                <span className="local-model-badge">未下载</span>
              )}
            </div>
            <div className="local-model-meta">
              {builtinStatus
                ? `${formatSize(builtinStatus.bytes)} · ${builtinStatus.dimensions} 维`
                : '读取中…'}
            </div>
          </div>
          <div className="local-model-actions">
            {builtinStatus?.installed ? (
              <>
                <button
                  className="mini-btn"
                  disabled={builtinBusy}
                  onClick={() => void testBuiltin()}
                >
                  {builtinBusy ? <Loader2 size={12} className="spin" /> : null} 测试
                </button>
                <button
                  className="mini-btn"
                  disabled={draft.knowledge.provider === 'local'}
                  onClick={useBuiltin}
                >
                  {draft.knowledge.provider === 'local' ? '当前' : '使用'}
                </button>
                <button
                  className="mini-btn"
                  disabled={draft.knowledge.provider === 'local'}
                  title={
                    draft.knowledge.provider === 'local' ? '先切换知识库向量来源' : '删除模型'
                  }
                  onClick={() => void removeBuiltin()}
                >
                  <Trash2 size={12} />
                </button>
              </>
            ) : (
              <button
                className="mini-btn primary"
                disabled={builtinBusy}
                onClick={() => void downloadBuiltin()}
              >
                <Download size={12} /> {builtinBusy ? '下载中' : '下载'}
              </button>
            )}
          </div>
        </div>
        {builtinProgress && builtinProgress.percent < 100 && (
          <div className="local-model-progress">
            <span className="settings-hint">
              {builtinProgress.message} · {builtinProgress.percent}%
            </span>
            {builtinBusy && (
              <button
                className="mini-btn"
                onClick={() => window.bsub.cancelLocalEmbeddingDownload?.()}
              >
                取消
              </button>
            )}
          </div>
        )}
        {builtinTest && <div className="settings-hint">{builtinTest}</div>}
        <div className="settings-hint">
          下载后点「使用」，保存设置，再在下方「知识库索引」点构建；从 AI 平台切到本地需要重建索引。
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">
          <Database size={12} /> 本地向量服务（知识库 embedding）
        </div>
        <div className="settings-group-sub">
          知识库需要 OpenAI 兼容的 /embeddings 接口；本机 Ollama / LM Studio / llama.cpp
          都提供，本地地址不需要 Key。
        </div>
        <div className="local-model-row">
          <div className="local-model-main">
            <div className="local-model-name">
              当前知识库
              <span className={`local-model-badge ${kbLocal ? 'is-ready' : ''}`}>
                {kbPlatform ? (kbLocal ? '本地地址' : '云端') : '未配置'}
              </span>
            </div>
            <div className="local-model-meta">{kbText}</div>
          </div>
        </div>
        <div className="settings-inline">
          <input
            className="settings-input"
            value={localBaseUrl}
            spellCheck={false}
            placeholder="http://127.0.0.1:11434/v1"
            onChange={(event) => setLocalBaseUrl(event.target.value)}
          />
          <button
            className="mini-btn primary"
            disabled={probeBusy}
            onClick={() => void probeLocalService()}
          >
            {probeBusy ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            检测服务
          </button>
        </div>
        <div className="settings-inline">
          <button
            className="mini-btn"
            onClick={() => setLocalBaseUrl('http://127.0.0.1:11434/v1')}
          >
            Ollama
          </button>
          <button
            className="mini-btn"
            onClick={() => setLocalBaseUrl('http://127.0.0.1:1234/v1')}
          >
            LM Studio
          </button>
          <button
            className="mini-btn"
            onClick={() => setLocalBaseUrl('http://127.0.0.1:8080/v1')}
          >
            llama.cpp
          </button>
        </div>
        <div className="settings-group-sub">
          没有 embedding 模型？用本机 Ollama 拉取（下载由 Ollama 完成，不经过桌面端）：
        </div>
        <div className="settings-inline">
          <input
            className="settings-input"
            list="ollama-embedding-models"
            value={pullModel}
            spellCheck={false}
            placeholder="nomic-embed-text"
            onChange={(event) => setPullModel(event.target.value)}
          />
          <datalist id="ollama-embedding-models">
            {OLLAMA_EMBEDDING_CATALOG.map((item) => (
              <option key={item.model} value={item.model}>
                {item.label}
              </option>
            ))}
          </datalist>
          <button
            className="mini-btn"
            disabled={pulling}
            onClick={() => void pullModelNow()}
          >
            {pulling ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
            拉取模型
          </button>
        </div>
        {pullProgress && (
          <div className="local-model-progress">
            <span className="settings-hint">
              {pullProgress.model} · {pullProgress.status}
              {pullProgress.percent > 0 ? ` · ${pullProgress.percent}%` : ''}
              {pullProgress.total && pullProgress.completed
                ? ` · ${formatSize(pullProgress.completed)} / ${formatSize(pullProgress.total)}`
                : ''}
            </span>
            {pulling && (
              <button
                className="mini-btn"
                onClick={() => window.bsub.cancelOllamaPull?.(pullProgress.model)}
              >
                取消
              </button>
            )}
          </div>
        )}
        {probeError && (
          <div className="settings-hint" style={{ color: 'var(--danger)' }}>
            {probeError}
          </div>
        )}
        {probeModels && (
          <>
            <div className="settings-inline">
              <select
                className="settings-input"
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
              >
                {visibleModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                {!visibleModels.length && <option value="">没有可用模型</option>}
              </select>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={showAllModels}
                  onChange={(event) => setShowAllModels(event.target.checked)}
                />
                显示全部模型
              </label>
            </div>
            <div className="settings-inline">
              <button
                className="mini-btn"
                disabled={!embeddingModel || testingEmbedding}
                onClick={() => void testEmbedding()}
              >
                {testingEmbedding ? <Loader2 size={12} className="spin" /> : null}
                测试向量
              </button>
              <button
                className="mini-btn primary"
                disabled={!embeddingModel}
                onClick={useEmbedding}
              >
                设为知识库 embedding
              </button>
              {embeddingTest && <span className="settings-hint">{embeddingTest}</span>}
            </div>
            <div className="settings-hint">
              检测到 {probeModels.length} 个模型；向量模型通常带 embed / bge / nomic 等字样，
              选对话模型会测不出维度。
            </div>
          </>
        )}
        <div className="local-model-row">
          <div className="local-model-main">
            <div className="local-model-name">
              知识库索引
              <span className={`local-model-badge ${kbStatus?.ready ? 'is-ready' : ''}`}>
                {kbStatus ? (kbStatus.ready ? '已就绪' : '待构建') : '读取中…'}
              </span>
            </div>
            <div className="local-model-meta">
              {kbStatus
                ? `${kbStatus.chunks} 块 / ${kbStatus.videos} 个视频 · ${
                    kbStatus.model || '未设置模型'
                  }`
                : '读取中…'}
            </div>
          </div>
          <div className="local-model-actions">
            <button
              className="mini-btn primary"
              disabled={buildingIndex || !draft.knowledge.enabled}
              title={!draft.knowledge.enabled ? '先启用知识库' : undefined}
              onClick={() => void buildIndex()}
            >
              {buildingIndex ? <Loader2 size={12} className="spin" /> : null}
              {kbStatus?.chunks ? '重建索引' : '构建索引'}
            </button>
          </div>
        </div>
        {kbProgress && <div className="settings-hint">{kbProgress.message}</div>}
        <div className="settings-hint">
          Ollama 可先运行 <code>ollama pull nomic-embed-text</code>；LM Studio 在「开发者」页启动本地服务。
          改完 embedding 设置要先保存，再点「构建索引」。
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">
          <ScanText size={12} /> 其他本地能力
        </div>
        <div className="local-model-row">
          <div className="local-model-main">
            <div className="local-model-name">
              文字识别（OCR）
              <span className={`local-model-badge ${ocrLocal ? 'is-ready' : ''}`}>
                {ocrLocal ? '离线' : '自建服务'}
              </span>
            </div>
            <div className="local-model-meta">{ocrText}</div>
          </div>
        </div>
        <div className="settings-hint">
          文字识别默认走 Windows 离线 OCR；接 PaddleOCR 时填本机或局域网服务地址即可。
        </div>
      </div>

      <div className="settings-hint">
        模型下载与删除只影响本机的用户数据目录；正在使用的模型会被保护，先切换再删除。
      </div>
    </SettingsSection>
  );
}
