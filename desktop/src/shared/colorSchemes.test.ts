import { describe, expect, it } from 'vitest';
import { COLOR_SCHEMES } from './colorSchemes';

describe('color schemes', () => {
  it('id 唯一且都有浅/深色', () => {
    const ids = COLOR_SCHEMES.map((scheme) => scheme.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scheme of COLOR_SCHEMES) {
      expect(scheme.light.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(scheme.dark.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
