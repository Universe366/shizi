import { getZoomTarget } from './zoomTarget';
import type { SidebarWebManager } from './sidebarWeb';
import type { TabManager } from './tabs';

/**
 * 页面控制统一入口：主标签页和侧栏网页共用缩放 / 查找 / 主题。
 * 页面宿主仍然分开，但 IPC 不再自己判断该操作哪一边。
 */
export class PageControl {
  constructor(
    private readonly tabs: TabManager,
    private readonly sidebar?: SidebarWebManager
  ) {}

  target(): 'tab' | 'sidebar' {
    return this.sidebarActive() ? 'sidebar' : 'tab';
  }

  private sidebarActive(): boolean {
    return (
      getZoomTarget() === 'sidebar' &&
      Boolean(this.sidebar?.activeWebContents())
    );
  }

  getZoom(): number {
    return this.sidebarActive()
      ? (this.sidebar?.getZoom() ?? 1)
      : this.tabs.getZoom();
  }

  setZoom(value: number): void {
    if (this.sidebarActive()) this.sidebar?.setZoom(value);
    else this.tabs.setZoom(value);
  }

  zoomIn(): void {
    if (this.sidebarActive()) this.sidebar?.zoomIn();
    else this.tabs.zoomIn();
  }

  zoomOut(): void {
    if (this.sidebarActive()) this.sidebar?.zoomOut();
    else this.tabs.zoomOut();
  }

  zoomReset(): void {
    if (this.sidebarActive()) this.sidebar?.zoomReset();
    else this.tabs.zoomReset();
  }

  find(
    query: string,
    options: { forward?: boolean; findNext?: boolean } = {}
  ): void {
    if (this.sidebarActive()) this.sidebar?.find(query, options.forward !== false);
    else this.tabs.findInPage(query, options);
  }

  stopFind(): void {
    if (this.sidebarActive()) this.sidebar?.stopFind();
    else this.tabs.stopFind();
  }

  reapplyTheme(): void {
    this.tabs.setWebDarkMode();
    this.sidebar?.setWebDarkMode();
  }
}
