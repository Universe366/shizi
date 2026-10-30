import { session } from 'electron';
import type { AppSettings } from '../shared/types';
import { platformForTask } from './settings';

export interface ImageGenResult {
  dataUrl: string;
  mime: string;
  ms: number;
  provider: AppSettings['image']['provider'];
}

function trimBase(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

function sizeParts(size: string): { width: number; height: number } {
  const match = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(String(size || '').trim());
  if (!match) return { width: 1024, height: 1024 };
  return {
    width: Math.min(2048, Math.max(256, Number(match[1]))),
    height: Math.min(2048, Math.max(256, Number(match[2])))
  };
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; mime: string }> {
  const response = await session.defaultSession.fetch(url, {
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`);
  const mime = response.headers.get('content-type') || 'image/png';
  const bytes = Buffer.from(await response.arrayBuffer());
  return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, mime };
}

async function openAiImage(prompt: string, settings: AppSettings['image']): Promise<ImageGenResult> {
  const base = trimBase(settings.baseUrl);
  if (!base) throw new Error('请先填写图片生成接口地址');
  if (!settings.model.trim()) throw new Error('请先填写图片模型');
  const response = await session.defaultSession.fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      prompt,
      n: 1,
      size: settings.size || '1024x1024',
      response_format: 'b64_json'
    }),
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`图片接口 HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (first?.b64_json) {
    return {
      dataUrl: `data:image/png;base64,${first.b64_json}`,
      mime: 'image/png',
      ms: 0,
      provider: 'openai'
    };
  }
  if (first?.url) {
    const image = await fetchImageAsDataUrl(first.url);
    return { ...image, ms: 0, provider: 'openai' };
  }
  throw new Error('图片接口没有返回图片');
}

async function a1111Image(prompt: string, settings: AppSettings['image']): Promise<ImageGenResult> {
  const base = trimBase(settings.baseUrl) || 'http://127.0.0.1:7860';
  const { width, height } = sizeParts(settings.size);
  const response = await session.defaultSession.fetch(`${base}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      steps: Math.min(80, Math.max(1, Number(settings.steps) || 20)),
      width,
      height,
      cfg_scale: 7,
      send_images: true,
      save_images: false
    }),
    signal: AbortSignal.timeout(240000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SD WebUI HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as { images?: string[] };
  const image = data.images?.[0];
  if (!image) throw new Error('SD WebUI 没有返回图片');
  return {
    dataUrl: `data:image/png;base64,${image}`,
    mime: 'image/png',
    ms: 0,
    provider: 'a1111'
  };
}

async function comfyImage(prompt: string, settings: AppSettings['image']): Promise<ImageGenResult> {
  const base = trimBase(settings.baseUrl) || 'http://127.0.0.1:8188';
  let workflow: unknown;
  try {
    workflow = JSON.parse(settings.workflow);
  } catch {
    throw new Error('ComfyUI 工作流不是有效 JSON');
  }
  const raw = JSON.stringify(workflow);
  if (!raw.includes('__PROMPT__')) {
    throw new Error('ComfyUI 工作流里需要留一个 __PROMPT__ 占位符');
  }
  const clientId = `shizi-${Date.now()}`;
  const queued = await session.defaultSession.fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: JSON.parse(raw.replace(/__PROMPT__/g, prompt)), client_id: clientId }),
    signal: AbortSignal.timeout(30000)
  });
  if (!queued.ok) {
    const body = await queued.text().catch(() => '');
    throw new Error(`ComfyUI HTTP ${queued.status}：${body.slice(0, 200)}`);
  }
  const task = (await queued.json()) as { prompt_id?: string };
  if (!task.prompt_id) throw new Error('ComfyUI 没有返回任务 id');
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const history = await session.defaultSession.fetch(`${base}/history/${task.prompt_id}`, {
      signal: AbortSignal.timeout(30000)
    });
    if (!history.ok) continue;
    const payload = (await history.json()) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
    const entry = payload[task.prompt_id];
    for (const output of Object.values(entry?.outputs || {})) {
      const image = output.images?.[0];
      if (!image) continue;
      const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output'
      });
      const result = await fetchImageAsDataUrl(`${base}/view?${query.toString()}`);
      return { ...result, ms: 0, provider: 'comfyui' };
    }
  }
  throw new Error('ComfyUI 生成超时');
}

/** 按设置生成图片；provider 决定协议，API Key 只在 openai 兼容模式使用。 */
export async function generateImage(
  prompt: string,
  settings: AppSettings
): Promise<ImageGenResult> {
  const clean = String(prompt || '').trim().slice(0, 4000);
  if (!clean) throw new Error('请先输入图片描述');
  if (!settings.image.enabled) throw new Error('图片生成未启用');
  const started = Date.now();
  let config = settings.image;
  if (config.provider === 'openai' && settings.ai.taskModels?.image) {
    const taskPlatform = platformForTask('image', settings);
    if (taskPlatform) {
      config = {
        ...config,
        baseUrl: taskPlatform.baseUrl,
        apiKey: taskPlatform.apiKey,
        model: settings.ai.taskModels.image?.model || taskPlatform.model
      };
    }
  }
  const result =
    config.provider === 'a1111'
      ? await a1111Image(clean, config)
      : config.provider === 'comfyui'
        ? await comfyImage(clean, config)
        : await openAiImage(clean, config);
  return { ...result, ms: Date.now() - started };
}
