/**
 * 给一个 Promise 加硬截止，并可选跟随外部 AbortSignal。
 * 联网检索这类不可控的外部请求用它兜底：超时只放弃等待，不阻塞主流程。
 */
export function withDeadline<T>(
  task: Promise<T>,
  ms: number,
  signal?: AbortSignal,
  message = '操作超时',
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () =>
      finish(() => reject(Object.assign(new Error('已取消'), { name: 'AbortError' })));
    const timer = setTimeout(() => {
      // 先让调用方中止底层请求，再结束等待；不依赖它完成。
      try {
        onTimeout?.();
      } catch {
        // ignore
      }
      finish(() => reject(Object.assign(new Error(message), { name: 'TimeoutError' })));
    }, ms);
    // 先接住 task 的结果，保证即便 signal 已经取消也不会留下未处理的 rejection。
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
