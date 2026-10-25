import { Notification } from 'electron';
import { loadSettings, saveSettings } from './settings';

/** 待办提醒：每 30 秒扫一次设置文件，到点就发系统通知。 */
export function startTodoReminders(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const settings = loadSettings();
      const now = Date.now();
      let changed = false;
      for (const todo of settings.general.petTodos || []) {
        if (todo.done || !todo.dueAt || todo.notified) continue;
        if (todo.dueAt > now) continue;
        todo.notified = true;
        changed = true;
        try {
          new Notification({ title: '拾字提醒', body: todo.text }).show();
        } catch (error) {
          console.warn('[reminder] 通知失败:', (error as Error).message);
        }
      }
      if (changed) saveSettings(settings);
    } catch (error) {
      console.warn('[reminder] 检查失败:', (error as Error).message);
    }
  }, 30_000);
  timer.unref?.();
  return timer;
}
