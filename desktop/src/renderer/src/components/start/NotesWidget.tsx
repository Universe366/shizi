import { useEffect, useState, type CSSProperties } from 'react';
import { Eraser, StickyNote } from 'lucide-react';

const NOTES_KEY = 'start-notes';

function readNotes(): string {
  try {
    return localStorage.getItem(NOTES_KEY) || '';
  } catch {
    return '';
  }
}

/** 便签：直接写在起始页，改动自动存本地。 */
export function NotesWidget({ style }: { style?: CSSProperties }) {
  const [text, setText] = useState(readNotes);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, text);
      } catch {
        // ignore
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <article className="start-widget start-notes-widget" style={style}>
      <header className="start-widget-head">
        <StickyNote size={15} />
        <span>便签</span>
        <span className="start-widget-meta">{text.length} 字</span>
        {text.trim() && (
          <button className="start-widget-icon" title="清空便签" onClick={() => setText('')}>
            <Eraser size={12} />
          </button>
        )}
      </header>
      <textarea
        className="start-notes-input"
        value={text}
        placeholder="随手记点什么，自动保存在本机…"
        aria-label="起始页便签"
        onChange={(event) => setText(event.target.value)}
      />
    </article>
  );
}
