/** 从待办文本里解析提醒时间，返回去掉时间短语的正文和毫秒时间戳。 */
export function parseReminder(
  raw: string,
  now = Date.now()
): { text: string; dueAt?: number } {
  const source = String(raw || '').trim();
  if (!source) return { text: source };
  let text = source;
  let dueAt: number | undefined;

  const minutes = /(\d{1,3})\s*分钟后/.exec(source);
  const hours = /(\d{1,2})\s*小时后/.exec(source);
  if (minutes) {
    dueAt = now + Number(minutes[1]) * 60_000;
    text = source.replace(minutes[0], '').trim();
  } else if (hours) {
    dueAt = now + Number(hours[1]) * 3_600_000;
    text = source.replace(hours[0], '').trim();
  } else {
    const tomorrow = /明天\s*(\d{1,2})[:：](\d{2})/.exec(source);
    const today = /(今天\s*)?(\d{1,2})[:：](\d{2})/.exec(source);
    const match = tomorrow || today;
    if (match) {
      const date = new Date(now);
      date.setSeconds(0, 0);
      if (tomorrow) {
        date.setDate(date.getDate() + 1);
      }
      date.setHours(Number(match[tomorrow ? 1 : 2]), Number(match[tomorrow ? 2 : 3]), 0, 0);
      if (!tomorrow && date.getTime() <= now) date.setDate(date.getDate() + 1);
      dueAt = date.getTime();
      text = source.replace(match[0], '').trim();
    }
  }

  if (!text) text = source;
  return { text: text.slice(0, 200), dueAt };
}

export function formatReminder(dueAt: number | undefined, now = Date.now()): string {
  if (!dueAt) return '';
  const date = new Date(dueAt);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
}
