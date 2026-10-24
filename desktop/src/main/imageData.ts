import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { fitWithin } from './petGeometry';

/**
 * 截图压缩：视觉模型按图计费，整屏 PNG 动辄 1–3MB。
 * 统一缩到最长边 ≤1600 并转 JPEG(90)，尺寸可预期、payload 小一个数量级。
 */
export function compressImage(
  image: NativeImage,
  max = 1600,
  quality = 90
): { dataUrl: string; width: number; height: number } | null {
  if (!image || image.isEmpty()) return null;
  const size = image.getSize();
  const target = fitWithin(size.width, size.height, max);
  const scaled =
    target.width === size.width && target.height === size.height
      ? image
      : image.resize({ width: target.width, height: target.height, quality: 'good' });
  const jpeg = scaled.toJPEG(quality);
  if (!jpeg || jpeg.length === 0) return null;
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: target.width,
    height: target.height
  };
}

export function compressDataUrl(
  dataUrl: string,
  max = 1600,
  quality = 90
): { dataUrl: string; width: number; height: number } | null {
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    return compressImage(image, max, quality);
  } catch {
    return null;
  }
}
