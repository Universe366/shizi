/** 地址栏展示用：去掉协议、www. 与末尾斜杠，尽量贴近 Edge 的紧凑写法。 */
export function compactUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
    const host = url.hostname.replace(/^www\./i, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}${url.search}`;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}
