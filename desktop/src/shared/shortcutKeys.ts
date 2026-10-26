// 快捷键的存储格式与匹配：统一用 KeyboardEvent.code（物理键位），
// 避免美式键盘 Ctrl+Shift+3 的 key 变成 '#' 这类布局差异。
// 存储示例：`Ctrl+Shift+Digit3`、`Alt+KeyR`、`Ctrl+Comma`。

export interface KeyStroke {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight'
]);

const KEY_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert'
};

/** 允许作为快捷键按键的 code。 */
export function isShortcutKeyCode(code: string): boolean {
  if (!code) return false;
  if (MODIFIER_CODES.has(code)) return false;
  if (/^Key[A-Z]$/.test(code)) return true;
  if (/^Digit[0-9]$/.test(code)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return true;
  return code in KEY_LABELS;
}

export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return KEY_LABELS[code] || code;
}

export function strokeFromEvent(event: {
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyStroke | null {
  const code = String(event.code || '');
  if (!isShortcutKeyCode(code)) return null;
  return {
    code,
    ctrl: event.ctrlKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
    meta: event.metaKey === true
  };
}

/** 录制时用：没按修饰键的普通字符不允许当快捷键，避免抢走打字。 */
export function isRecordableStroke(stroke: KeyStroke): boolean {
  if (stroke.ctrl || stroke.alt || stroke.meta) return true;
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(stroke.code);
}

export function formatShortcut(stroke: KeyStroke): string {
  const parts: string[] = [];
  if (stroke.ctrl) parts.push('Ctrl');
  if (stroke.alt) parts.push('Alt');
  if (stroke.shift) parts.push('Shift');
  if (stroke.meta) parts.push('Meta');
  parts.push(stroke.code);
  return parts.join('+');
}

export function prettyShortcut(accelerator: string): string {
  const parsed = parseShortcut(accelerator);
  if (!parsed) return accelerator;
  const parts: string[] = [];
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.meta) parts.push('Meta');
  parts.push(keyLabel(parsed.code));
  return parts.join(' + ');
}

export function parseShortcut(accelerator: string): KeyStroke | null {
  const tokens = String(accelerator || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  let code = '';
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') ctrl = true;
    else if (lower === 'alt') alt = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'meta' || lower === 'win' || lower === 'super') meta = true;
    else if (!code) code = token;
    else return null;
  }
  if (!isShortcutKeyCode(code)) return null;
  return { code, ctrl, alt, shift, meta };
}

export function matchesShortcut(stroke: KeyStroke | null, accelerator: string): boolean {
  if (!stroke) return false;
  const parsed = parseShortcut(accelerator);
  if (!parsed) return false;
  return (
    parsed.code === stroke.code &&
    parsed.ctrl === stroke.ctrl &&
    parsed.alt === stroke.alt &&
    parsed.shift === stroke.shift &&
    parsed.meta === stroke.meta
  );
}
