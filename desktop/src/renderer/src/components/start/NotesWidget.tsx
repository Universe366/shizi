import type { CSSProperties, HTMLAttributes } from 'react';
import { ChevronDown, ChevronUp, Eraser, StickyNote } from 'lucide-react';

interface NotesWidgetProps {
  style?: CSSProperties;
  widgetProps?: HTMLAttributes<HTMLElement>;
  text: string;
  onChange: (value: string) => void;
  onClear: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** 便签：直接写在起始页，内容由 StartPage 统一持久化。 */
export function NotesWidget({
  style,
  widgetProps,
  text,
  onChange,
  onClear,
  collapsed = false,
  onToggleCollapse
}: NotesWidgetProps) {
  return (
    <article
      className={`start-widget start-notes-widget${collapsed ? ' is-collapsed' : ''}`}
      {...widgetProps}
      style={style}
    >
      <header className="start-widget-head">
        <StickyNote size={15} />
        <span>便签</span>
        <span className="start-widget-meta">{text.length} 字</span>
        {text.trim() && (
          <button className="start-widget-icon" title="清空便签" onClick={onClear}>
            <Eraser size={12} />
          </button>
        )}
        {onToggleCollapse && (
          <button
            className="start-widget-icon"
            title={collapsed ? '展开' : '折叠'}
            onClick={onToggleCollapse}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
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
