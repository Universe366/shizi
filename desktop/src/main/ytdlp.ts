/** yt-dlp 输出解析：进度行 → 百分比 / 体积 / 速度 / 剩余时间。 */
export interface YtDlpProgress {
  percent: number;
  total: string;
  speed: string;
  eta: string;
}

const PROGRESS = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?\s*[\d.]+\s*[A-Za-z]+)(?:\s+at\s+([\d.]+\s*[A-Za-z]+\/s|Unknown[^\s]*))?(?:\s+ETA\s+([\d:]+|Unknown))?/;

export function parseYtDlpProgress(line: string): YtDlpProgress | null {
  const match = PROGRESS.exec(String(line || ''));
  if (!match) return null;
  const percent = Math.max(0, Math.min(100, Number(match[1])));
  return {
    percent,
    total: (match[2] || '').trim(),
    speed: (match[3] || '').trim(),
    eta: (match[4] || '').trim()
  };
}

/** 列表下载时的“正在下载第 N / M 项”。 */
export function parseYtDlpItem(line: string): { index: number; total: number } | null {
  const match = /\[download\]\s+Downloading\s+(?:(?:item|video)\s+)?(\d+)\s+of\s+(\d+)/i.exec(
    String(line || '')
  );
  if (!match) return null;
  return { index: Number(match[1]), total: Number(match[2]) };
}

/** 把单个文件的进度合成整个队列的进度（0–99）。 */
export function overallPercent(itemIndex: number, itemTotal: number, percent: number): number {
  if (!itemTotal || itemTotal <= 1) return Math.min(99, Math.round(percent));
  const done = Math.max(0, itemIndex - 1);
  return Math.min(99, Math.round(((done + percent / 100) / itemTotal) * 100));
}
