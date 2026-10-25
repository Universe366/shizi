import { describe, expect, it } from 'vitest';
import {
  PET_EDGE_SNAP,
  bodyRectFor,
  clampRectToArea,
  cornerBodyRect,
  decayVelocity,
  speedOf,
  defaultBodyRect,
  defaultPetRect,
  fitWithin,
  nearestWorkArea,
  normalizePetSize,
  petLayoutForState,
  petLayoutSize,
  rubberBandRect,
  snapRectToEdges,
  windowRectFor
} from './petGeometry';

const HD = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1280, y: 0, width: 1280, height: 1024 };

describe('normalizePetSize', () => {
  it('限制在 64–180，非法值回默认', () => {
    expect(normalizePetSize(undefined)).toBe(96);
    expect(normalizePetSize(0)).toBe(96);
    expect(normalizePetSize(-20)).toBe(96);
    expect(normalizePetSize(10)).toBe(64);
    expect(normalizePetSize(64)).toBe(64);
    expect(normalizePetSize(300)).toBe(180);
    expect(normalizePetSize(120)).toBe(120);
  });
});

describe('petLayoutSize', () => {
  it('compact 只包住桌宠本体', () => {
    expect(petLayoutSize('compact', 96)).toEqual({ width: 108, height: 130 });
  });

  it('气泡/挂件/菜单都比 compact 大', () => {
    const compact = petLayoutSize('compact', 96);
    for (const mode of ['bubble', 'widget', 'menu'] as const) {
      const size = petLayoutSize(mode, 96);
      expect(size.width).toBeGreaterThan(compact.width);
      expect(size.height).toBeGreaterThan(compact.height);
    }
    expect(petLayoutSize('bubble', 96).width).toBe(452);
  });

  it('尺寸随桌宠大小线性变化', () => {
    expect(petLayoutSize('compact', 180).height - petLayoutSize('compact', 96).height).toBe(84);
  });
});

describe('petLayoutForState', () => {
  it('优先级：气泡 > 菜单 > 挂件 > 紧凑', () => {
    expect(petLayoutForState({ open: true, widgetOpen: true, menuOpen: true })).toBe('bubble');
    expect(petLayoutForState({ open: false, widgetOpen: true, menuOpen: true })).toBe('menu');
    expect(petLayoutForState({ open: false, widgetOpen: true, menuOpen: false })).toBe('widget');
    expect(petLayoutForState({ open: false, widgetOpen: false, menuOpen: false })).toBe('compact');
  });
});

describe('clampRectToArea', () => {
  it('把越界窗口拉回工作区', () => {
    const rect = { x: 1800, y: 1000, width: 200, height: 200 };
    expect(clampRectToArea(rect, HD)).toEqual({ x: 1720, y: 840, width: 200, height: 200 });
  });

  it('负坐标（左侧副屏）也留在本屏', () => {
    const rect = { x: -2000, y: -80, width: 200, height: 200 };
    expect(clampRectToArea(rect, LEFT)).toEqual({ x: -1280, y: 0, width: 200, height: 200 });
  });

  it('区域比窗口还小时不产生负坐标', () => {
    const tiny = { x: 10, y: 10, width: 100, height: 100 };
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    expect(clampRectToArea(rect, tiny)).toMatchObject({ x: 10, y: 10 });
  });
});

describe('snapRectToEdges', () => {
  it('靠近边缘时吸附', () => {
    const nearLeft = { x: HD.x + PET_EDGE_SNAP - 1, y: 400, width: 120, height: 140 };
    expect(snapRectToEdges(nearLeft, HD).x).toBe(0);

    const nearBottom = { x: 400, y: HD.height - 140 - 10, width: 120, height: 140 };
    expect(snapRectToEdges(nearBottom, HD).y).toBe(HD.height - 140);
  });

  it('离边缘远时不动', () => {
    const rect = { x: 300, y: 300, width: 120, height: 140 };
    expect(snapRectToEdges(rect, HD)).toEqual(rect);
  });

  it('吸附后仍然在屏幕内', () => {
    const rect = { x: 1915, y: 1030, width: 200, height: 200 };
    const snapped = snapRectToEdges(rect, HD);
    expect(snapped.x).toBe(1720);
    expect(snapped.y).toBe(840);
  });
});

describe('defaultPetRect', () => {
  it('右下角留 24px 边距', () => {
    const rect = defaultPetRect(96, HD);
    expect(rect.x + rect.width).toBe(HD.width - 24);
    expect(rect.y + rect.height).toBe(HD.height - 24);
  });

  it('小屏上也放得下', () => {
    const tiny = { x: 0, y: 0, width: 300, height: 300 };
    const rect = defaultPetRect(180, tiny, 'bubble');
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });
});

describe('nearestWorkArea', () => {
  it('点在哪个屏就用哪个屏', () => {
    expect(nearestWorkArea({ x: 100, y: 100 }, [HD, LEFT])).toBe(HD);
    expect(nearestWorkArea({ x: -600, y: 300 }, [HD, LEFT])).toBe(LEFT);
  });

  it('点不在任何屏里时取最近的一块', () => {
    expect(nearestWorkArea({ x: -1500, y: -400 }, [HD, LEFT])).toBe(LEFT);
    expect(nearestWorkArea({ x: 5000, y: 5000 }, [HD, LEFT])).toBe(HD);
  });

  it('没有显示器时返回 null，没有坐标时取第一块', () => {
    expect(nearestWorkArea({ x: 0, y: 0 }, [])).toBeNull();
    expect(nearestWorkArea(null, [HD, LEFT])).toBe(HD);
  });
});

describe('本体与窗口坐标互转', () => {
  it('任意布局下本体都在窗口底部居中', () => {
    for (const mode of ['compact', 'bubble', 'widget', 'menu'] as const) {
      const body = { x: 500, y: 400, width: 120, height: 120 };
      const win = windowRectFor(body, mode, 120);
      expect(win.width).toBe(petLayoutSize(mode, 120).width);
      expect(win.height).toBe(petLayoutSize(mode, 120).height);
      expect(bodyRectFor(win, 120)).toEqual(body);
    }
  });

  it('切换布局时本体位置（屏幕坐标）不变', () => {
    const body = { x: 800, y: 300, width: 120, height: 120 };
    const compact = windowRectFor(body, 'compact', 120);
    const bubble = windowRectFor(body, 'bubble', 120);
    expect(bodyRectFor(compact, 120)).toEqual(body);
    expect(bodyRectFor(bubble, 120)).toEqual(body);
    // 气泡是向上长的：窗口顶边更高，底边保持不变
    expect(bubble.y).toBeLessThan(compact.y);
    expect(bubble.y + bubble.height).toBe(compact.y + compact.height);
  });

  it('默认本体位置留 24px 边距', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const body = defaultBodyRect(96, area);
    expect(body.x + body.width).toBe(1920 - 24);
    expect(body.y + body.height).toBe(1040 - 24);
  });
});

describe('fitWithin（截图压缩尺寸）', () => {
  it('超过上限时等比缩小', () => {
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(1000, 2400, 1600)).toEqual({ width: 667, height: 1600 });
  });

  it('不放大', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('非法尺寸给 1x1，避免除零', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe('cornerBodyRect', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('四个角落都能落位', () => {
    expect(cornerBodyRect(96, area, 'bottom-right')).toEqual({ x: 1800, y: 920, width: 96, height: 96 });
    expect(cornerBodyRect(96, area, 'bottom-left')).toEqual({ x: 24, y: 920, width: 96, height: 96 });
    expect(cornerBodyRect(96, area, 'top-right')).toEqual({ x: 1800, y: 24, width: 96, height: 96 });
    expect(cornerBodyRect(96, area, 'top-left')).toEqual({ x: 24, y: 24, width: 96, height: 96 });
  });

  it('小屏也不会越界', () => {
    const tiny = { x: 0, y: 0, width: 200, height: 200 };
    const rect = cornerBodyRect(180, tiny, 'bottom-right');
    expect(rect.x + rect.width).toBeLessThanOrEqual(200);
    expect(rect.y + rect.height).toBeLessThanOrEqual(200);
  });
});

describe('rubberBandRect', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const clamped = { x: 880, y: 680, width: 120, height: 120 };

  it('没越界时不动', () => {
    expect(rubberBandRect(clamped, clamped)).toEqual(clamped);
  });

  it('越界只露出 30%，松开后能被拉回', () => {
    const target = { x: 980, y: 760, width: 120, height: 120 };
    const soft = rubberBandRect(target, clamped, 0.3);
    expect(soft.x).toBe(910);
    expect(soft.y).toBe(704);
    // 仍然越界但幅度更小
    expect(soft.x + soft.width).toBeGreaterThan(area.width);
    expect(soft.x + soft.width).toBeLessThan(target.x + target.width);
  });
});

describe('气泡尺寸可配置', () => {
  it('默认 440×480，窗口按内容加边距', () => {
    expect(petLayoutSize('bubble', 96)).toEqual({ width: 452, height: 614 });
  });

  it('自定义尺寸会跟着变', () => {
    expect(petLayoutSize('bubble', 120, { width: 600, height: 640 })).toEqual({
      width: 612,
      height: 798
    });
  });

  it('窗口始终包住本体且本体位置不变', () => {
    const body = { x: 600, y: 300, width: 96, height: 96 };
    const win = windowRectFor(body, 'bubble', 96, { width: 600, height: 640 });
    expect(bodyRectFor(win, 96)).toEqual(body);
  });
});

describe('拖拽惯性', () => {
  it('速度按时间衰减，16ms 一帧衰减 10%', () => {
    const next = decayVelocity({ vx: 1, vy: 0 }, 16, 0.9);
    expect(next.vx).toBeCloseTo(0.9, 5);
    expect(next.vy).toBe(0);
  });

  it('同样时间里，两帧比一帧衰减更多', () => {
    const once = decayVelocity({ vx: 2, vy: 0 }, 32, 0.9).vx;
    const twice = decayVelocity(decayVelocity({ vx: 2, vy: 0 }, 16, 0.9), 16, 0.9).vx;
    expect(twice).toBeCloseTo(once, 5);
  });

  it('速度会衰减到停（<0.02）', () => {
    let v = { vx: 1.2, vy: 0.6 };
    let frames = 0;
    while (speedOf(v) >= 0.02 && frames < 200) {
      v = decayVelocity(v, 16, 0.9);
      frames += 1;
    }
    expect(speedOf(v)).toBeLessThan(0.02);
    expect(frames).toBeLessThan(80);
  });
});
