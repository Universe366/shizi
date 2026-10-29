import { useLayoutEffect, useRef, useState } from 'react';
import type { PageContextMenuPayload } from '../../../shared/types';
import { canonicalUrl } from '../../../shared/url';

interface Props {
  menu: PageContextMenuPayload | null;
  onClose: () => void;
}

/** 网页右键菜单：原生视图会盖住 DOM，打开时由浮层机制临时隐藏网页。 */
export function PageContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const rect = ref.current?.getBoundingClientRect();
    const width = rect?.width || 200;
    const height = rect?.height || 260;
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
    });
  }, [menu]);

  if (!menu) return null;
  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div className="page-context-backdrop" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={ref}
        className="page-context-menu"
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="page-context-item" disabled={!menu.canGoBack} onClick={() => run(() => window.bsub.pageContextAction('back'))}>
          后退
        </button>
        <button className="page-context-item" disabled={!menu.canGoForward} onClick={() => run(() => window.bsub.pageContextAction('forward'))}>
          前进
        </button>
        <button className="page-context-item" onClick={() => run(() => window.bsub.pageContextAction('reload'))}>
          刷新
        </button>
        <div className="page-context-sep" />
        <button className="page-context-item" disabled={!menu.canCopy} onClick={() => run(() => void window.bsub.writeClipboard(menu.selectionText))}>
          复制
        </button>
        {menu.isEditable && (
          <>
            <button className="page-context-item" disabled={!menu.canPaste} onClick={() => run(() => window.bsub.pageContextAction('paste'))}>
              粘贴
            </button>
            <button className="page-context-item" onClick={() => run(() => window.bsub.pageContextAction('select-all'))}>
              全选
            </button>
          </>
        )}
        {menu.linkURL && (
          <>
            <div className="page-context-sep" />
            <button className="page-context-item" onClick={() => run(() => void window.bsub.newTab(menu.linkURL))}>
              在新标签页打开链接
            </button>
            <button className="page-context-item" onClick={() => run(() => void window.bsub.writeClipboard(canonicalUrl(menu.linkURL)))}>
              复制链接地址
            </button>
          </>
        )}
        {menu.srcURL && (
          <button className="page-context-item" onClick={() => run(() => void window.bsub.writeClipboard(menu.srcURL))}>
            复制图片地址
          </button>
        )}
        {menu.devMode && (
          <>
            <div className="page-context-sep" />
            <button className="page-context-item" onClick={() => run(() => window.bsub.pageContextAction('inspect', menu.pageX, menu.pageY))}>
              检查元素
            </button>
          </>
        )}
      </div>
    </div>
  );
}
