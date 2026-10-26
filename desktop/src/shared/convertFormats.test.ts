import { describe, expect, it } from 'vitest';
import { CONVERT_FORMATS, convertGroupOf, formatsForFile } from './convertFormats';

describe('文件转换格式', () => {
  it('按扩展名识别来源类型', () => {
    expect(convertGroupOf('a/b/c.mp4')).toBe('video');
    expect(convertGroupOf('x.wav')).toBe('audio');
    expect(convertGroupOf('x.PNG')).toBe('image');
    expect(convertGroupOf('x.docx')).toBeNull();
  });

  it('图片只给图片目标，视频给全部', () => {
    expect(formatsForFile('x.png').every((item) => item.group === 'image')).toBe(true);
    expect(formatsForFile('x.mp4').length).toBe(CONVERT_FORMATS.length);
    expect(formatsForFile('x.docx')).toEqual([]);
  });
});
