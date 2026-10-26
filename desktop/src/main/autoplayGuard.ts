/**
 * 恢复会话时注入到页面：用户还没有任何操作前，压住页面的自动播放。
 *
 * 背景：程序退出时视频还在播，重开后会按 URL 重新加载页面；B 站等站点
 * 会自己 autoplay。用户只是恢复上次的标签，不应该突然出声。
 * 只要用户点一下/按一下，就永久放行（不再拦截）。
 */
export const AUTOPLAY_GUARD_SCRIPT = `(() => {
  if (window.__shiziAutoplayGuard) return;
  window.__shiziAutoplayGuard = true;
  let allow = false;
  let timer = 0;
  const stop = () => {
    allow = true;
    if (timer) clearInterval(timer);
  };
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('keydown', stop, true);
  window.addEventListener('wheel', stop, { capture: true, passive: true });
  const pauseAll = () => {
    if (allow) return;
    document.querySelectorAll('video, audio').forEach((element) => {
      try {
        if (!element.paused) element.pause();
      } catch {}
    });
  };
  window.addEventListener(
    'play',
    (event) => {
      if (allow) return;
      const element = event.target;
      if (element && typeof element.pause === 'function') {
        try {
          element.pause();
        } catch {}
      }
    },
    true
  );
  document.addEventListener('DOMContentLoaded', pauseAll);
  window.addEventListener('load', pauseAll);
  let ticks = 0;
  timer = setInterval(() => {
    ticks += 1;
    pauseAll();
    if (allow || ticks > 40) clearInterval(timer);
  }, 500);
})();`;
