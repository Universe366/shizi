import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  /** 撑满父容器（面板级空态） */
  fill?: boolean;
  /** 紧凑模式（表格/列表内） */
  compact?: boolean;
  /** 无边框（对话区这类纯文本空态） */
  plain?: boolean;
  className?: string;
}

/** 统一空态：图标 + 标题 + 说明 + 操作，所有面板共用一套间距与字号。 */
export function EmptyState({
  icon,
  title,
  desc,
  action,
  children,
  fill = false,
  compact = false,
  plain = false,
  className = ''
}: EmptyStateProps) {
  return (
    <div
      className={[
        'empty-state',
        fill ? 'is-fill' : '',
        compact ? 'is-compact' : '',
        plain ? 'is-plain' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && <div className="empty-state-icon">{icon}</div>}
      {title && <div className="empty-state-title">{title}</div>}
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action && <div className="empty-state-action">{action}</div>}
      {children}
    </div>
  );
}
