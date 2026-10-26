// @vitest-environment jsdom
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OVERLAY_SELECTORS, overlayVisible } from './browserOverlay';

// jsdom 不做布局，getClientRects 永远是空列表；这里按 display 模拟「有没有渲染出来」。
const original = Element.prototype.getClientRects;
beforeAll(() => {
  Element.prototype.getClientRects = function getClientRects(this: Element) {
    const display = window.getComputedStyle(this).display;
    if (display === 'none') return [] as unknown as DOMRectList;
    return [
      { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }
    ] as unknown as DOMRectList;
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(() => {
  Element.prototype.getClientRects = original;
});

describe('overlayVisible', () => {
  it('常驻的导出按钮包装层不算浮层', () => {
    // 回归：.export-menu 是工具栏按钮的外层 div，一直在 DOM 里。
    // 以前把它当浮层，侧栏展开或总结完成时会误隐藏网页视图（表现为网页变白）。
    document.body.innerHTML = `
      <aside class="sidebar">
        <div class="side-panel is-active">
          <div class="panel-toolbar"><div class="export-menu"><button>导出</button></div></div>
        </div>
      </aside>`;
    expect(OVERLAY_SELECTORS).not.toContain('.export-menu');
    expect(overlayVisible()).toBe(false);
  });

  it('真正的浮层仍然要隐藏网页', () => {
    document.body.innerHTML = '<div class="page-host"></div>';
    expect(overlayVisible()).toBe(true);

    document.body.innerHTML = '<div class="confirm-backdrop"></div>';
    expect(overlayVisible()).toBe(true);

    document.body.innerHTML = '<div class="palette-backdrop"></div>';
    expect(overlayVisible()).toBe(true);

    document.body.innerHTML = '<div class="reader-overlay"></div>';
    expect(overlayVisible()).toBe(true);
  });

  it('导出下拉真正打开时算浮层', () => {
    document.body.innerHTML = '<div class="export-popover"><button>Markdown</button></div>';
    expect(overlayVisible()).toBe(true);
  });

  it('display:none 的浮层不算', () => {
    document.body.innerHTML =
      '<div class="page-host" style="display:none"></div><div class="confirm-backdrop" style="display:none"></div>';
    expect(overlayVisible()).toBe(false);
  });
});
