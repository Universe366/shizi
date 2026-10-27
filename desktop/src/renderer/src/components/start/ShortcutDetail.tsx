import { Copy, ExternalLink, Pencil, X } from 'lucide-react';
import type { StartShortcut } from '../../../../shared/types';
import { faviconOf, hostOf, originOf, tileColor } from './model';

interface Props {
  item: StartShortcut;
  usage: number;
  onOpen: (item: StartShortcut) => void;
  onEdit: (item: StartShortcut) => void;
  onCopy: (url: string) => void;
  onClose: () => void;
}

/** 快捷方式详情：描述、分组、标签、打开次数与常用操作。 */
export function ShortcutDetail({ item, usage, onOpen, onEdit, onCopy, onClose }: Props) {
  const color = tileColor(hostOf(item.url) || item.label);
  return (
    <div className="start-modal-backdrop" onMouseDown={onClose}>
      <div
        className="start-modal start-detail"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="start-detail-head">
          <span className="start-tile-icon" style={{ background: color.bg, color: color.fg }}>
            <span className="start-tile-letter">{item.label.slice(0, 1).toUpperCase()}</span>
            {originOf(item.url) && (
              <img src={faviconOf(item.url)} alt="" referrerPolicy="no-referrer" />
            )}
          </span>
          <div className="start-detail-titles">
            <div className="start-detail-title">{item.label}</div>
            <div className="start-detail-host">{hostOf(item.url)}</div>
          </div>
          <button className="start-detail-close" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {item.desc ? <p className="start-detail-desc">{item.desc}</p> : null}

        <div className="start-detail-meta">
          <span>分组：{item.group || '常用'}</span>
          <span>打开 {usage} 次</span>
        </div>

        {item.tags?.length ? (
          <div className="start-detail-tags">
            {item.tags.map((tag) => (
              <span key={tag} className="start-tag is-static">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="start-detail-url" title={item.url}>
          {item.url}
        </div>

        <div className="start-modal-actions">
          <button className="mini-btn" onClick={() => onCopy(item.url)}>
            <Copy size={12} /> 复制链接
          </button>
          <button className="mini-btn" onClick={() => onEdit(item)}>
            <Pencil size={12} /> 编辑
          </button>
          <button className="mini-btn primary" onClick={() => onOpen(item)}>
            <ExternalLink size={12} /> 打开
          </button>
        </div>
      </div>
    </div>
  );
}
