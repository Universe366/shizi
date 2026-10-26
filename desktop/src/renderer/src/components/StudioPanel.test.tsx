// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StudioPanel } from './StudioPanel';

function installBsub() {
  const api = {
    listExports: vi.fn(async () => ({ ok: true as const, data: [] })),
    onSynthesizeDone: vi.fn(() => () => undefined),
    onLocalTransProgress: vi.fn(() => () => undefined),
    onLocalTransDone: vi.fn(() => () => undefined),
    onLocalTransError: vi.fn(() => () => undefined),
    onTranslateProgress: vi.fn(() => () => undefined),
    onTranslateDone: vi.fn(() => () => undefined),
    onTranslateError: vi.fn(() => () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('StudioPanel', () => {
  afterEach(cleanup);

  it('渲染一条连续流水线，而不是步骤导航页', () => {
    installBsub();
    render(<StudioPanel />);
    const steps = Array.from(document.querySelectorAll('.pipeline-step .pipeline-title b')).map(
      (node) => node.textContent
    );
    expect(steps).toEqual(['选择素材', '生成字幕', '整理字幕', '出成片']);
    expect(document.querySelectorAll('.pipeline-connector')).toHaveLength(3);
    // 不再有左侧步骤导航
    expect(document.querySelector('.workbench-nav')).toBeNull();
    // 成片记录在流水线底部
    expect(document.querySelector('.pipeline-renders .renders-panel')).toBeTruthy();
    expect(screen.getByText('选择素材')).toBeTruthy();
  });
});
