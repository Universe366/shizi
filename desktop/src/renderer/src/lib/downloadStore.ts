import { useSyncExternalStore } from 'react';
import type { DownloadProgressEvent } from '../../../shared/types';

export interface ActiveDownload {
  requestId: string;
  videoId: number;
  title: string;
  percent: number;
  speed: string;
  eta: string;
  message: string;
  startedAt: number;
}

let tasks: Record<string, ActiveDownload> = {};
const listeners = new Set<() => void>();
let subscribed = false;

function emit(): void {
  tasks = { ...tasks };
  for (const listener of listeners) listener();
}

function remove(requestId: string): void {
  if (!tasks[requestId]) return;
  const next = { ...tasks };
  delete next[requestId];
  tasks = next;
  emit();
}

function ensureSubscribed(): void {
  if (subscribed) return;
  const api = window.bsub;
  if (!api?.onDownloadProgress) return;
  subscribed = true;
  api.onDownloadProgress((event: DownloadProgressEvent) => {
    const task = tasks[event.requestId];
    if (!task) return;
    tasks = {
      ...tasks,
      [event.requestId]: {
        ...task,
        percent: Math.max(0, Math.min(100, Number(event.percent) || 0)),
        speed: event.speed || '',
        eta: event.eta || '',
        message: event.message || ''
      }
    };
    emit();
  });
  api.onDownloadDone?.((event) => remove(event.requestId));
  api.onDownloadError?.((event) => remove(event.requestId));
}

/** 记录一次下载；放在模块级 store 里，切换页面/卸载组件也不会丢进度。 */
export function trackDownload(requestId: string, videoId: number, title: string): void {
  ensureSubscribed();
  tasks = {
    ...tasks,
    [requestId]: {
      requestId,
      videoId,
      title,
      percent: 0,
      speed: '',
      eta: '',
      message: '准备下载…',
      startedAt: Date.now()
    }
  };
  emit();
}

export function useActiveDownloads(): Record<string, ActiveDownload> {
  ensureSubscribed();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tasks,
    () => tasks
  );
}

export function activeDownloadFor(
  downloads: Record<string, ActiveDownload>,
  videoId: number
): ActiveDownload | undefined {
  return Object.values(downloads).find((task) => task.videoId === videoId);
}
