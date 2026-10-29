import type { CSSProperties } from 'react';
import { Eraser, StickyNote } from 'lucide-react';

interface NotesWidgetProps {
  style?: CSSProperties;
  text: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

/** 便签：直接写在起始页，内容由 StartPage 统一持久化。 */
export function NotesWidget({ style, text, onChange, onClear }: NotesWidgetProps) {
  return (
    <article className="start-widget start-notes-widget" style={style}>
      <header className="start-widget-head">
        <StickyNote size={15} />
        <span>便签</span>
        <span className="start-widget-meta">{text.length} 字</span>
        {text.trim() && (
          <button className="start-widget-icon" title="清空便签" onClick={onClear}>
            <Eraser size={12} />
          </button>
        )}
      </header>
      <textarea
        className="start-notes-input"
        value={text}
        placeholder="随手记点什么，自动保存在本机…"
        aria-label="起始页便签"
        onChange={(event) => onChange(event.target.value)}
      />
    </article>
  );
}
