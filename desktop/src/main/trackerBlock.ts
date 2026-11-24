import { session } from 'electron';

/** 只拦统计/广告常见域名，不动站点自己的接口，避免误伤播放。 */
const TRACKER_HOSTS = [
  'doubleclick.net',
  'googletagmanager.com',
  'google-analytics.com',
  'googlesyndication.com',
  'hm.baidu.com',
  'cnzz.com',
  'umeng.com',
  'scorecardresearch.com',
  'hotjar.com',
  'connect.facebook.net',
  'ads-twitter.com',
  'bat.bing.com'
];

export function isTrackerHost(host: string): boolean {
  const value = String(host || '').toLowerCase();
  return TRACKER_HOSTS.some((item) => value === item || value.endsWith(`.${item}`));
}

let enabled = false;

export function setTrackerBlockingEnabled(value: boolean): void {
  enabled = value === true;
}

/** 在 app ready 后调用一次；开关变化时只需 setTrackerBlockingEnabled。 */
export function installTrackerBlocking(initial: boolean): void {
  setTrackerBlockingEnabled(initial);
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (!enabled) {
        callback({});
        return;
      }
      try {
        if (isTrackerHost(new URL(details.url).hostname)) {
          callback({ cancel: true });
          return;
        }
      } catch {
        // 非法 URL 交给默认行为
      }
      callback({});
    });
  } catch {
    // 默认会话尚未就绪时静默跳过
  }
}
