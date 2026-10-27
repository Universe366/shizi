import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>;

let handler: ConfirmHandler | null = null;

/** 由 ConfirmHost 在挂载时注册；没有宿主时退回原生 confirm（单测与极端情况）。 */
export function bindConfirmHandler(next: ConfirmHandler | null): void {
  handler = next;
}

/** 统一的二次确认：返回用户是否确认。 */
export function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const normalized = typeof options === 'string' ? { title: options } : options;
  if (handler) return handler(normalized);
  const text = normalized.description
    ? `${normalized.title}\n${normalized.description}`
    : normalized.title;
  return Promise.resolve(window.confirm(text));
}

/** 挂在 App 根部：把 askConfirm 的 Promise 接到应用内弹窗上。 */
export function ConfirmHost() {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  useEffect(() => {
    bindConfirmHandler(
      (options) =>
        new Promise<boolean>((resolve) => {
          setState({ options, resolve });
        })
    );
    return () => bindConfirmHandler(null);
  }, []);

  const finish = (value: boolean) => {
    if (!state) return;
    state.resolve(value);
    setState(null);
  };

  return (
    <ConfirmDialog
      open={Boolean(state)}
      title={state?.options.title || ''}
      description={state?.options.description}
      confirmText={state?.options.confirmText}
      cancelText={state?.options.cancelText}
      danger={state?.options.danger ?? true}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  );
}
