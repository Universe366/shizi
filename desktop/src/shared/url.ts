/** 地址栏展示用：去掉协议、www.、跟踪参数与末尾斜杠，尽量贴近 Edge 的紧凑写法。 */
const TRACKING_PARAMS = [
  'spm_id_from',
  'from_source',
  'from_spmid',
  'vd_source',
  'share_source',
  'share_medium',
  'share_plat',
  'share_tag',
  'share_times',
  'share_from',
  'buvid',
  'up_id',
  'timestamp',
  'unique_k',
  'bbid',
  'seid',
  'session_id',
  'pvid',
  'msource',
  'csource',
  'spm',
  'scene',
  'business',
  'plat_id'
];

export function compactUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
    for (const key of TRACKING_PARAMS) url.searchParams.delete(key);
    const host = url.hostname.replace(/^www\./i, '');
    const path = url.pathname.replace(/\/+$/, '');
    const query = url.searchParams.toString();
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

/** 复制用：保留完整协议与路径，去掉常见跟踪参数。 */
export function canonicalUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
    for (const key of TRACKING_PARAMS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}
