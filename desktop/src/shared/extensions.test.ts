import { describe, expect, it } from 'vitest';
import {
  BROWSER_EXTENSION_LIMIT,
  isAbsoluteExtensionPath,
  normalizeBrowserExtensions
} from './extensions';

describe('浏览器扩展列表规范化', () => {
  it('保留合法绝对路径并按路径去重（大小写不敏感）', () => {
    const items = normalizeBrowserExtensions([
      { id: 'a', path: 'C:\\Ext\\One', name: 'One', version: '1.0.0', manifestVersion: 3 },
      { id: 'b', path: 'c:\\ext\\one', name: 'One again', version: '1.0.0' },
      { id: 'c', path: '/opt/ext/two', name: 'Two', version: '2.0.0', manifestVersion: 2 }
    ]);
    expect(items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(items[1].manifestVersion).toBe(2);
  });

  it('丢弃相对路径、空 id 与非对象条目', () => {
    const items = normalizeBrowserExtensions([
      null,
      'x',
      { id: 'ok', path: 'relative/dir', name: 'bad' },
      { id: '', path: 'D:\\Ext', name: 'no id' },
      { id: 'good', path: 'D:\\Ext', name: 'good' }
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'good', name: 'good' });
  });

  it('缺省值：enabled=true，manifestVersion 非法时回退 3', () => {
    const [item] = normalizeBrowserExtensions([
      { id: 'x', path: 'E:\\Ext', name: '', version: '', manifestVersion: 9 }
    ]);
    expect(item).toMatchObject({
      id: 'x',
      name: '未命名扩展',
      version: '',
      manifestVersion: 3,
      enabled: true
    });
  });

  it('数量不超过上限', () => {
    const input = Array.from({ length: BROWSER_EXTENSION_LIMIT + 5 }, (_, index) => ({
      id: `ext${index}`,
      path: `C:\\Ext\\${index}`,
      name: `E${index}`
    }));
    expect(normalizeBrowserExtensions(input)).toHaveLength(BROWSER_EXTENSION_LIMIT);
  });

  it('识别绝对路径', () => {
    expect(isAbsoluteExtensionPath('C:\\a')).toBe(true);
    expect(isAbsoluteExtensionPath('c:/a')).toBe(true);
    expect(isAbsoluteExtensionPath('\\\\server\\share')).toBe(true);
    expect(isAbsoluteExtensionPath('/tmp/a')).toBe(true);
    expect(isAbsoluteExtensionPath('a\\b')).toBe(false);
  });
});
