import type { SubtitleLine, SubtitleStyle } from './types';

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontName: 'Microsoft YaHei',
  fontSize: 54,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outline: 2,
  shadow: 1,
  marginV: 36,
  bilingual: false,
  alignment: 2
};

function assTime(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.floor((total - Math.floor(total)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function assColor(hex: string): string {
  const text = String(hex || '').replace('#', '').trim();
  const value = /^[0-9a-f]{6}$/i.test(text) ? text : 'FFFFFF';
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`;
}

function assEscape(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

export interface AssOptions {
  style?: Partial<SubtitleStyle>;
  /** 双语时第二条字幕（译文）放在原文上方 */
  translated?: SubtitleLine[];
}

export function buildAss(lines: SubtitleLine[], options: AssOptions = {}): string {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, ...(options.style || {}) };
  const translated = options.translated;
  const bilingual =
    style.bilingual &&
    Array.isArray(translated) &&
    translated.length === lines.length;
  const secondaryMargin = Math.max(10, style.marginV + Math.round(style.fontSize * 1.25));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${assColor(style.primaryColor)},&H000000FF,${assColor(style.outlineColor)},&H64000000,0,0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.alignment},40,40,${style.marginV},1
${bilingual ? `Style: Secondary,${style.fontName},${Math.max(24, Math.round(style.fontSize * 0.78))},${assColor(style.primaryColor)},&H000000FF,${assColor(style.outlineColor)},&H64000000,0,0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.alignment},40,40,${secondaryMargin},1` : ''}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogues = lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      const rows = [
        `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${assEscape(line.text)}`
      ];
      if (bilingual) {
        const translatedText = translated?.[index]?.text || '';
        if (translatedText) {
          rows.push(
            `Dialogue: 1,${assTime(start)},${assTime(end)},Secondary,,0,0,0,,${assEscape(translatedText)}`
          );
        }
      }
      return rows.join('\n');
    })
    .join('\n');
  return `${header}${dialogues}\n`;
}
