// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyAppearance } from './appearance';

describe('外观应用', () => {
  afterEach(() => {
    document.getElementById('shizi-custom-css')?.remove();
    document.documentElement.removeAttribute('data-density');
  });

  it('写入强调色与密度', () => {
    applyAppearance({ accentColor: '#123abc', density: 'compact', customCss: '' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123abc');
    expect(document.documentElement.style.getPropertyValue('--accent-soft')).toBe('#123abc24');
    expect(document.documentElement.dataset.density).toBe('compact');
  });

  it('非法颜色回退默认值', () => {
    applyAppearance({ accentColor: 'red', density: 'comfortable' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#4f6f8f');
  });

  it('自定义 CSS 注入并可清空', () => {
    applyAppearance({ accentColor: '#4f6f8f', density: 'comfortable', customCss: '.x{color:red}' });
    expect(document.getElementById('shizi-custom-css')?.textContent).toContain('color:red');
    applyAppearance({ accentColor: '#4f6f8f', density: 'comfortable', customCss: '' });
    expect(document.getElementById('shizi-custom-css')?.textContent).toBe('');
  });
});
