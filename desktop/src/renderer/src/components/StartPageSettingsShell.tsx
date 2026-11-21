import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** 起始页设置抽屉外壳：遮罩、aside、标题与关闭按钮。 */
export function StartPageSettingsShell({ open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <>
      <div className="sc-sheet-mask" onClick={onClose} />
      <aside className="sc-sheet" aria-label="自定义起始页">
        <header>
          <span>自定义起始页</span>
          <button type="button" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
