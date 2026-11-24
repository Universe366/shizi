import type { ReactNode } from 'react';

/**
 * 每组设置底部的「高级与维护」抽屉：
 * 只放低频/专业项，默认收起，避免首屏铺满控件。
 */
export function AdvancedSettings({
  children,
  count
}: {
  children: ReactNode;
  /** 可选：抽屉里包含的分区数量，显示在标题上 */
  count?: number;
}) {
  return (
    <details className="settings-advanced">
      <summary>
        <span>高级与维护</span>
        {count ? <span className="settings-advanced-count">{count} 项</span> : null}
      </summary>
      <div className="settings-advanced-body">{children}</div>
    </details>
  );
}
