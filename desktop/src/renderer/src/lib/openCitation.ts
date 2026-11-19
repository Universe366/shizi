/** 引用/来源优先在内置标签页打开；打不开时才交给系统浏览器。 */
export async function openCitation(url: string): Promise<void> {
  const target = String(url || '').trim();
  if (!target) return;
  if (!/^https?:\/\//i.test(target)) {
    try {
      await window.bsub.openExternal(target);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await window.bsub.openUrl(target);
    return;
  } catch {
    // 内置打开失败（如视图创建异常）再回退外部浏览器。
  }
  try {
    await window.bsub.openExternal(target);
  } catch {
    // ignore
  }
}
