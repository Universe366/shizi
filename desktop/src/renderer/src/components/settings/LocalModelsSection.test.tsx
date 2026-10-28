// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppSettings, AsrLocalStatus, AsrPlatform } from '../../../../shared/types';
import { LocalModelsSection } from './LocalModelsSection';

const localPlatform = {
  id: 'local-whisper',
  name: '本地 Whisper',
  kind: 'local-whisper',
  baseUrl: '',
  apiKey: '',
  model: '',
  models: [],
  localExe: 'C:\\models\\whisper\\whisper.cpp-cpu\\whisper-cli.exe',
  localModel: 'C:\\models\\whisper\\ggml-tiny.bin'
} as unknown as AsrPlatform;

const draft = {
  ai: {
    activeId: 'ollama',
    platforms: [
      {
        id: 'ollama',
        name: 'Ollama（本地）',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        model: 'qwen3'
      }
    ]
  },
  knowledge: { enabled: true, platformId: 'ollama', model: 'nomic-embed-text' },
  ocr: { engine: 'system', lang: 'auto', paddleUrl: '' }
} as unknown as AppSettings;

const status: AsrLocalStatus = {
  dir: 'C:\\models\\whisper',
  models: { tiny: 'C:\\models\\whisper\\ggml-tiny.bin' },
  binaries: { cpu: 'C:\\models\\whisper\\whisper.cpp-cpu\\whisper-cli.exe' },
  binary: 'C:\\models\\whisper\\whisper.cpp-cpu\\whisper-cli.exe',
  note: '模型保存在用户数据目录',
  totalBytes: 200 * 1024 * 1024,
  modelCatalog: [
    {
      id: 'tiny',
      label: 'tiny · 最快、准确率一般',
      size: 74 * 1024 * 1024,
      downloaded: true,
      partialBytes: 0
    },
    {
      id: 'base',
      label: 'base · 推荐',
      size: 141 * 1024 * 1024,
      downloaded: false,
      partialBytes: 0
    }
  ],
  binaryCatalog: [
    {
      variant: 'cpu',
      label: 'CPU（通用）',
      note: '没有独立显卡时选这个。',
      size: 8 * 1024 * 1024,
      downloaded: true,
      partialBytes: 0
    },
    {
      variant: 'vulkan',
      label: 'Vulkan',
      note: 'AMD 显卡推荐。',
      size: 20 * 1024 * 1024,
      downloaded: false,
      partialBytes: 0
    }
  ]
};

const props = () => ({
  draft,
  activeAsr: localPlatform,
  updateAsrPlatform: vi.fn(),
  onUseLocalEmbedding: vi.fn()
});

describe('本地模型设置', () => {
  const localAsrStatus = vi.fn(async () => ({ ok: true as const, data: status }));
  const downloadAsrModel = vi.fn(async () => ({
    ok: true as const,
    data: { path: 'C:\\models\\whisper\\ggml-base.bin' }
  }));
  const deleteAsrModel = vi.fn(async () => ({
    ok: true as const,
    data: { removed: true, status }
  }));
  const downloadAsrBinary = vi.fn(async () => ({
    ok: true as const,
    data: { path: 'C:\\models\\whisper\\vulkan\\whisper-cli.exe' }
  }));
  const pullOllamaEmbedding = vi.fn(async () => ({
    ok: true as const,
    data: { model: 'nomic-embed-text' }
  }));

  beforeEach(() => {
    localStorage.clear();
    localAsrStatus.mockClear();
    downloadAsrModel.mockClear();
    deleteAsrModel.mockClear();
    downloadAsrBinary.mockClear();
    (window as unknown as { bsub: unknown }).bsub = {
      localAsrStatus,
      downloadAsrModel,
      deleteAsrModel,
      downloadAsrBinary,
      deleteAsrBinary: vi.fn(async () => ({ ok: true as const, data: { removed: true, status } })),
      detectGpu: vi.fn(async () => ({ ok: true as const, data: { names: ['NVIDIA GeForce RTX 4070'] } })),
      cancelAsrDownload: vi.fn(),
      openDataDir: vi.fn(),
      onAsrDownloadProgress: vi.fn(() => () => {}),
      probePlatformModels: vi.fn(async () => ({
        ok: true as const,
        data: { models: ['nomic-embed-text', 'qwen3:8b'], url: 'http://127.0.0.1:11434/v1/models' }
      })),
      testLocalEmbedding: vi.fn(async () => ({
        ok: true as const,
        data: { dimensions: 768, latencyMs: 12, model: 'nomic-embed-text' }
      })),
      pullOllamaEmbedding,
      cancelOllamaPull: vi.fn(),
      onOllamaPullProgress: vi.fn(() => () => {}),
      kbStatus: vi.fn(async () => ({
        ok: true as const,
        data: { chunks: 0, videos: 0, model: '', ready: false }
      })),
      kbIndex: vi.fn(async () => ({
        ok: true as const,
        data: { chunks: 3, videos: 1, model: 'nomic-embed-text', ready: true }
      })),
      onKbProgress: vi.fn(() => () => {})
    };
  });

  afterEach(cleanup);

  const button = (text: string) =>
    screen
      .getAllByRole('button')
      .find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

  it('列出清单、占用与本地能力状态', async () => {
    render(<LocalModelsSection {...props()} />);
    await waitFor(() => expect(screen.getByText(/200\.0 MB/)).toBeTruthy());
    expect(screen.getByText('tiny · 最快、准确率一般')).toBeTruthy();
    expect(screen.getByText('base · 推荐')).toBeTruthy();
    expect(screen.getAllByText('使用中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本地地址').length).toBeGreaterThan(0);
    expect(screen.getByText(/Windows 系统 OCR/)).toBeTruthy();
  });

  it('下载未安装的模型', async () => {
    render(<LocalModelsSection {...props()} />);
    await waitFor(() => expect(screen.getByText('base · 推荐')).toBeTruthy());
    fireEvent.click(button('下载'));
    await waitFor(() => expect(downloadAsrModel).toHaveBeenCalledWith('base'));
  });

  it('未完成的下载可以继续或清理', async () => {
    localAsrStatus.mockImplementationOnce(async () => ({
      ok: true as const,
      data: {
        ...status,
        totalBytes: status.totalBytes + 10 * 1024 * 1024,
        modelCatalog: status.modelCatalog.map((row) =>
          row.id === 'base' ? { ...row, partialBytes: 10 * 1024 * 1024 } : row
        )
      }
    }));
    const p = props();
    p.activeAsr = { ...localPlatform, localModel: '' };
    render(<LocalModelsSection {...p} />);
    await waitFor(() => expect(screen.getByText(/未完成 10\.0 MB/)).toBeTruthy());
    expect(button('继续下载')).toBeTruthy();
    fireEvent.click(screen.getByTitle('删除未完成的下载'));
    await waitFor(() => expect(deleteAsrModel).toHaveBeenCalledWith('base'));
  });

  it('正在使用的模型不允许删除', async () => {
    render(<LocalModelsSection {...props()} />);
    await waitFor(() => expect(screen.getByText('tiny · 最快、准确率一般')).toBeTruthy());
    const row = screen.getByText('tiny · 最快、准确率一般').closest('.local-model-row') as HTMLElement;
    const trash = row.querySelector('.local-model-actions button:last-child') as HTMLButtonElement;
    fireEvent.click(trash);
    await waitFor(() => expect(screen.getByText(/当前转写正在使用/)).toBeTruthy());
    expect(deleteAsrModel).not.toHaveBeenCalled();
  });

  it('检测本地服务、测试向量并设为知识库', async () => {
    const p = props();
    render(<LocalModelsSection {...p} />);
    await waitFor(() => expect(screen.getByText('当前知识库')).toBeTruthy());
    fireEvent.click(button('检测服务'));
    await waitFor(() => expect(screen.getByDisplayValue('nomic-embed-text')).toBeTruthy());
    fireEvent.click(button('测试向量'));
    await waitFor(() => expect(screen.getByText(/768 维/)).toBeTruthy());
    fireEvent.click(button('设为知识库'));
    expect(p.onUseLocalEmbedding).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1',
      'nomic-embed-text'
    );
  });

  it('配置好 embedding 后可以直接构建知识库索引', async () => {
    render(<LocalModelsSection {...props()} />);
    await waitFor(() => expect(screen.getByText('知识库索引')).toBeTruthy());
    fireEvent.click(button('构建索引'));
    await waitFor(() => expect(screen.getByText(/索引完成：3 块/)).toBeTruthy());
  });

  it('可以用 Ollama 拉取 embedding 模型', async () => {
    const p = props();
    render(<LocalModelsSection {...p} />);
    await waitFor(() => expect(screen.getByText('当前知识库')).toBeTruthy());
    fireEvent.click(button('拉取模型'));
    await waitFor(() =>
      expect(pullOllamaEmbedding).toHaveBeenCalledWith({
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'nomic-embed-text'
      })
    );
  });

  it('正在使用的模型禁用选用，检测显卡给出推荐', async () => {
    const p = props();
    render(<LocalModelsSection {...p} />);
    await waitFor(() => expect(screen.getByText('tiny · 最快、准确率一般')).toBeTruthy());
    const row = screen.getByText('tiny · 最快、准确率一般').closest('.local-model-row') as HTMLElement;
    const useButton = row.querySelector('.local-model-actions button') as HTMLButtonElement;
    expect(useButton.disabled).toBe(true);
    fireEvent.click(button('检测显卡'));
    await waitFor(() => expect(screen.getByText(/推荐 cuda124/)).toBeTruthy());
  });
});
