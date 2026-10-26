/**
 * 免费翻译兜底：MyMemory 公共接口（无需 Key，匿名有配额）。
 * 仅在 LLM 不可用/失败且用户显式开启时使用；逐条请求、限速、失败直接抛错。
 */
const TARGET: Record<string, string> = {
  中文: 'zh-CN',
  '中文（简体）': 'zh-CN',
  '中文（繁體）': 'zh-TW',
  英文: 'en',
  英语: 'en',
  English: 'en',
  日文: 'ja',
  日语: 'ja',
  日本語: 'ja',
  韩文: 'ko',
  韩语: 'ko',
  한국어: 'ko'
};

function normalizeTarget(target: string): string {
  const text = String(target || '').trim();
  if (TARGET[text]) return TARGET[text];
  if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/i.test(text)) {
    if (/^zh-TW$/i.test(text)) return 'zh-TW';
    return text;
  }
  return 'zh-CN';
}

function normalizeSource(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  return 'en';
}

export async function translateFree(
  texts: string[],
  target: string,
  signal?: AbortSignal
): Promise<string[]> {
  const to = normalizeTarget(target);
  const output: string[] = [];
  for (const text of texts) {
    if (signal?.aborted) throw new Error('已终止');
    const source = String(text || '').trim();
    if (!source) {
      output.push('');
      continue;
    }
    const from = normalizeSource(source);
    if (from === to) {
      output.push(source);
      continue;
    }
    if (source.length > 480) {
      // MyMemory 单次长度有限；过长的行不拆，直接保留原文，避免截断译文。
      output.push(source);
      continue;
    }
    const url =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(source) +
      `&langpair=${encodeURIComponent(from)}%7C${encodeURIComponent(to)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`免费翻译 HTTP ${response.status}`);
    const json = (await response.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
      responseDetails?: string;
    };
    if (json.responseStatus !== 200 || !json.responseData?.translatedText) {
      throw new Error(`免费翻译失败：${json.responseDetails || json.responseStatus || '无结果'}`);
    }
    output.push(String(json.responseData.translatedText).trim() || source);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return output;
}
