import { describe, expect, it, vi } from 'vitest';
import { withDeadline } from './async';

describe('withDeadline', () => {
  it('在截止前完成时透传结果', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('超时用 TimeoutError，不阻塞调用方', async () => {
    await expect(
      withDeadline(new Promise<string>(() => undefined), 10, undefined, '检索超时')
    ).rejects.toMatchObject({ name: 'TimeoutError', message: '检索超时' });
  });

  it('超时时先让调用方中止底层请求', async () => {
    const onTimeout = vi.fn();
    await expect(
      withDeadline(new Promise<string>(() => undefined), 10, undefined, '检索超时', onTimeout)
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('跟随外部 AbortSignal 取消', async () => {
    const controller = new AbortController();
    const pending = withDeadline(new Promise<string>(() => undefined), 5000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('已经取消的 signal 不会再留下未处理的 rejection', async () => {
    const controller = new AbortController();
    controller.abort();
    const rejected = Promise.reject(new Error('搜索失败'));
    await expect(withDeadline(rejected, 1000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    // 让 rejected 的 then 处理器有机会执行，确认没有 unhandled rejection。
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
