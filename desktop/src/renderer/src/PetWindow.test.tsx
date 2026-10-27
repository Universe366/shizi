// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PetWindow } from './PetWindow';

const SHOT = 'data:image/png;base64,AAAA';

function installBsub() {
  const handlers: {
    delta?: (event: unknown) => void;
    done?: (event: unknown) => void;
    error?: (event: unknown) => void;
    shot?: (result: unknown) => void;
    voice?: () => void;
    chat?: () => void;
  } = {};
  const api = {
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            petSize: 96,
            petOpacity: 1,
            petSound: true,
            petIdleTalk: true,
            petAlwaysOnTop: true,
            petTheme: 'mint',
            petMotion: true,
            petName: '小拾',
            petClickAction: 'chat',
            petDoubleClickAction: 'main',
            petIdleTalkMinutes: 3,
            petSleepMinutes: 5,
            petSoundVolume: 60,
            petSpeechRate: 1
          },
          ai: { preProofread: false },
          search: { verify: true }
        },
        version: '0.38.10'
      }
    })),
    getPageInfo: vi.fn(async () => ({
      ok: true as const,
      data: { title: '测试页', url: 'https://example.com', kind: 'video' }
    })),
    chat: vi.fn(async () => ({ ok: true as const, data: { requestId: 'pet-1' } })),
    cancelChat: vi.fn(async () => undefined),
    focusMain: vi.fn(async () => undefined),
    setPetEnabled: vi.fn(async () => undefined),
    setPetLayout: vi.fn(async () => undefined),
    setPetAlwaysOnTop: vi.fn(async (enabled: boolean) => enabled),
    toggleMedia: vi.fn(async () => ({ ok: true as const, data: { playing: false } })),
    resetPetPosition: vi.fn(async () => undefined),
    isMediaPlaying: vi.fn(async () => ({ ok: true as const, data: false })),
    petPosition: vi.fn(async () => ({ x: 100, y: 100 })),
    movePet: vi.fn(async () => undefined),
    dropPet: vi.fn(async () => ({ x: 10, y: 10 })),
    capturePage: vi.fn(async () => ({ ok: true as const, data: { dataUrl: SHOT } })),
    captureRegion: vi.fn(async () => ({ action: 'chat' as const, dataUrl: SHOT, width: 200, height: 120 })),
    onPetShot: vi.fn((cb: (result: unknown) => void) => {
      handlers.shot = cb;
      return () => {};
    }),
    onPetVoice: vi.fn((cb: () => void) => {
      handlers.voice = cb;
      return () => {};
    }),
    onPetChat: vi.fn((cb: () => void) => {
      handlers.chat = cb;
      return () => {};
    }),
    petFilePath: vi.fn((file: File) => `/tmp/${file.name}`),
    readPetFile: vi.fn(async () => ({
      ok: true as const,
      data: { kind: 'text' as const, name: 'a.txt', text: 'hello' }
    })),
    openSettings: vi.fn(async () => undefined),
    beginPetDrag: vi.fn(async () => undefined),
    petBlur: vi.fn(async () => undefined),
    endPetDrag: vi.fn(async () => ({ x: 10, y: 10, moved: false })),
    petBodyRect: vi.fn(async () => ({ x: 10, y: 10, width: 96, height: 96 })),
    petFlipped: vi.fn(async () => false),
    resizeBubble: vi.fn(async (width: number, height: number) => ({ width, height })),
    onPetFlipped: vi.fn((_cb: (below: boolean) => void) => () => {}),
    onSettingsChanged: vi.fn(() => () => {}),
    saveSettings: vi.fn(async (next: unknown) => ({ ok: true as const, data: { settings: next } })),
    readSelection: vi.fn(async () => ({
      ok: true as const,
      data: { title: '测试页', url: 'https://example.com', selection: '这段是被选中的文字' }
    })),
    onChatDelta: vi.fn((cb: (event: unknown) => void) => {
      handlers.delta = cb;
      return () => {};
    }),
    onChatDone: vi.fn((cb: (event: unknown) => void) => {
      handlers.done = cb;
      return () => {};
    }),
    onChatError: vi.fn((cb: (event: unknown) => void) => {
      handlers.error = cb;
      return () => {};
    })
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

async function openBubble() {
  fireEvent.click(screen.getByTitle(/点击聊天/));
  await waitFor(() => expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy());
}

function lastChatPayload(api: ReturnType<typeof installBsub>['api']) {
  const calls = api.chat.mock.calls as unknown as Array<
    [{ includePage: boolean; web: boolean; messages: Array<{ content: string; images?: string[] }> }]
  >;
  return calls.at(-1)?.[0] as {
    includePage: boolean;
    web: boolean;
    surface?: string;
    messages: Array<{ content: string; images?: string[] }>;
  };
}

describe('PetWindow', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('默认只有桌宠，点击展开气泡', async () => {
    installBsub();
    render(<PetWindow />);
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
    await openBubble();
    expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy();
  });

  it('按内容切换窗口布局：compact → bubble → compact', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    expect(api.setPetLayout).toHaveBeenLastCalledWith('compact');
    await openBubble();
    await waitFor(() => expect(api.setPetLayout).toHaveBeenLastCalledWith('bubble'));
    fireEvent.click(screen.getByTitle('关闭对话（Esc）'));
    await waitFor(() => expect(api.setPetLayout).toHaveBeenLastCalledWith('compact'), {
      timeout: 2000
    });
  });

  it('打开挂件时窗口变宽，挂件状态会记住', async () => {
    const { api } = installBsub();
    const first = render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    // 气泡与挂件互斥：打开挂件会收起气泡
    expect(api.setPetLayout).toHaveBeenLastCalledWith('widget');
    expect(localStorage.getItem('pet-widget')).toBe('1');
    first.unmount();

    const second = installBsub();
    render(<PetWindow />);
    expect(screen.getByPlaceholderText(/加一条待办/)).toBeTruthy();
    expect(second.api.setPetLayout).toHaveBeenLastCalledWith('widget');
  });

  it('框选截图选「对话」：带裁剪图提问，且不把整页正文塞进去', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));

    await vi.waitFor(() => expect(api.captureRegion).toHaveBeenCalled(), { timeout: 5000 });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.includePage).toBe(false);
    expect(payload.web).toBe(false);
    expect(payload.messages[0].images).toEqual([SHOT]);
    expect(payload.messages[0].content).toContain('截图');
  });

  it('框选截图选「提取文字」用 OCR 提示词', async () => {
    const { api } = installBsub();
    api.captureRegion.mockResolvedValueOnce({
      action: 'ocr',
      dataUrl: SHOT,
      width: 200,
      height: 120
    } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.messages[0].content).toContain('识别');
    expect(payload.messages[0].images).toEqual([SHOT]);
  });

  it('框选截图选「识别图片」只挂附件，等用户继续输入', async () => {
    const { api } = installBsub();
    api.captureRegion.mockResolvedValueOnce({
      action: 'image',
      dataUrl: SHOT,
      width: 200,
      height: 120
    } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(screen.getByAltText('当前页面截图')).toBeTruthy());
    expect(api.chat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('移除截图'));
    expect(screen.queryByAltText('当前页面截图')).toBeNull();
  });

  it('取消框选不发请求', async () => {
    const { api } = installBsub();
    api.captureRegion.mockResolvedValueOnce(null as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(api.captureRegion).toHaveBeenCalled());
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('右键菜单「整页截图」走 capturePage', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('整页截图'));
    await vi.waitFor(() => expect(api.capturePage).toHaveBeenCalled(), { timeout: 5000 });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('联网开关会带 web:true，并记住状态', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('打开联网检索'));
    expect(localStorage.getItem('pet-web')).toBe('1');
    expect(screen.getByPlaceholderText(/本轮会联网/)).toBeTruthy();

    const input = screen.getByPlaceholderText(/本轮会联网/);
    fireEvent.change(input, { target: { value: '查一下 Electron 45 发布时间' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastChatPayload(api).web).toBe(true);
  });

  it('解释选中：把选中文字作为上下文发出去', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByText('解释选中'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.messages[0].content).toContain('这段是被选中的文字');
    expect(payload.includePage).toBe(false);
  });

  it('没选中文字时给出提示，不发请求', async () => {
    const { api } = installBsub();
    api.readSelection.mockResolvedValueOnce({
      ok: true,
      data: { title: '测试页', url: 'https://example.com', selection: '' }
    } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByText('解释选中'));
    await vi.waitFor(() => expect(screen.getByText('先在网页里选中一段文字')).toBeTruthy());
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('截图后模型不支持图片时，提示去换视觉模型', async () => {
    const { api, handlers } = installBsub();
    api.chat.mockResolvedValueOnce({ ok: true, data: { requestId: 'pet-shot' } } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const first = (api.chat.mock.calls as unknown as Array<[{ requestId: string }]>)[0][0];
    handlers.error?.({ requestId: first.requestId, error: 'invalid content type for image' });
    expect(await screen.findByText(/不支持图片/)).toBeTruthy();
  });

  it('发送问题后，完成事件显示回答', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '这个版本号什么时候发的' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId, text: '它讲了三个要点', model: 'test' });
    expect(await screen.findByText('它讲了三个要点')).toBeTruthy();
  });

  it('联网回答会显示来源与检索失败提示', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '查一下最新价格' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({
      requestId,
      text: '这是联网回答',
      model: 'test',
      references: [{ title: '来源 A', url: 'https://example.com/a', snippet: '摘要' }],
      webEngine: 'Exa（语义搜索）',
      webError: '联网检索失败：超时'
    });
    expect(await screen.findByText('这是联网回答')).toBeTruthy();
    const source = await screen.findByTitle('https://example.com/a');
    expect(source.textContent).toContain('来源 A');
    expect(screen.getByText('Exa（语义搜索）')).toBeTruthy();
    expect(screen.getByText('联网检索失败：超时')).toBeTruthy();
  });

  it('生成中可点「停止」，会取消这次请求', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '慢慢想' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    fireEvent.click(screen.getByTitle('停止生成'));
    expect(api.cancelChat).toHaveBeenCalled();
    expect(screen.queryByTitle('停止生成')).toBeNull();
  });

  it('回答可以复制到剪贴板', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '要点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const requestId = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId, text: '复制我', model: 'test' });
    expect(await screen.findByText('复制我')).toBeTruthy();

    fireEvent.click(screen.getByTitle('把回答复制到剪贴板'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('复制我'));
    expect(await screen.findByText('已复制')).toBeTruthy();
  });

  it('右键菜单可用「看屏幕」并切换置顶、控制播放', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    expect(screen.getByText('截图（框选）')).toBeTruthy();
    expect(screen.getByText('继续播放')).toBeTruthy();

    fireEvent.click(screen.getByText('取消置顶'));
    await vi.waitFor(() => expect(api.setPetAlwaysOnTop).toHaveBeenCalledWith(false));

    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('继续播放'));
    await vi.waitFor(() => expect(api.toggleMedia).toHaveBeenCalled());
  });

  it('右键菜单可以重置位置和隐藏', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('重置位置'));
    expect(api.resetPetPosition).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('隐藏桌宠'));
    expect(api.setPetEnabled).toHaveBeenCalledWith(false);
  });

  it('Esc 先关菜单，再关气泡并把焦点还回去', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    expect(screen.getByText('截图（框选）')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('截图（框选）')).toBeNull(), { timeout: 3000 });

    await openBubble();
    expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy();
    // 让挂载后的异步 mock 事件先落地，避免 CI 上 Esc 与重开气泡抢跑。
    await new Promise((resolve) => setTimeout(resolve, 60));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull(), {
      timeout: 3000
    });
    expect(api.petBlur).toHaveBeenCalled();
  });

  it('挂件显示时钟并可加待办', async () => {
    installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    const input = screen.getByPlaceholderText(/加一条待办/);
    fireEvent.change(input, { target: { value: '写周报' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('写周报')).toBeTruthy();
  });

  it('双击桌宠打开主窗口（不触发展开/收起）', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    const body = screen.getByTitle(/点击聊天/);
    fireEvent.click(body);
    fireEvent.click(body);
    fireEvent.doubleClick(body);
    await waitFor(() => expect(api.focusMain).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
  });

  it('气泡右上角的 × 关闭对话（不隐藏桌宠）', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('关闭对话（Esc）'));
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
    expect(api.setPetEnabled).not.toHaveBeenCalled();
    expect(api.petBlur).toHaveBeenCalled();
  });
});

describe('PetWindow 回归', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('多轮对话会把上一轮问答带上', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();

    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '第一问' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    const first = (api.chat.mock.calls as unknown as Array<[{ requestId: string }]>)[0][0];
    handlers.done?.({ requestId: first.requestId, text: '第一答', model: 'test' });
    await screen.findByText('第一答');

    fireEvent.change(input, { target: { value: '再详细点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));

    const payload = lastChatPayload(api);
    const contents = payload.messages.map((item) => item.content);
    expect(contents).toContain('第一问');
    expect(contents).toContain('第一答');
    expect(payload.messages.at(-1)?.content).toBe('再详细点');
  });

  it('输入法确认候选词的回车不会发送', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '拼音' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as never);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('全局快捷键截完的图会直接发问', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    handlers.shot?.({ action: 'ocr', dataUrl: SHOT, width: 100, height: 50 });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    const payload = lastChatPayload(api);
    expect(payload.messages.at(-1)?.images).toEqual([SHOT]);
    expect(payload.messages.at(-1)?.content).toContain('识别');
  });

  it('取消截图会给出提示', async () => {
    const { api } = installBsub();
    api.captureRegion.mockResolvedValueOnce(null as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    expect(await screen.findByText('已取消截图')).toBeTruthy();
  });

  it('截图后可以点追问建议继续问，图片保留在附件里', async () => {
    const { api } = installBsub();
    api.captureRegion.mockResolvedValueOnce({
      action: 'image',
      dataUrl: SHOT,
      width: 200,
      height: 120
    } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(screen.getByAltText('当前页面截图')).toBeTruthy());
    fireEvent.click(screen.getByText('提取文字'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastChatPayload(api).messages.at(-1)?.images).toEqual([SHOT]);
    // 发完仍保留截图，方便继续追问
    expect(screen.getByAltText('当前页面截图')).toBeTruthy();
  });

  it('报错框里的「打开设置」调用 openSettings', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '问点什么' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    const first = (api.chat.mock.calls as unknown as Array<[{ requestId: string }]>)[0][0];
    handlers.error?.({ requestId: first.requestId, error: '没有可用的 Key' });
    fireEvent.click(await screen.findByText('打开设置'));
    expect(api.openSettings).toHaveBeenCalled();
  });
});

describe('PetWindow DIY', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('应用配色主题与名字', async () => {
    installBsub();
    render(<PetWindow />);
    await waitFor(() => expect(document.querySelector('.pet-root.pet-theme-mint')).toBeTruthy());
    await openBubble();
    expect(screen.getByText('小拾')).toBeTruthy();
  });

  it('单击动作可配置为截图', async () => {
    const { api } = installBsub();
    api.getSettings.mockResolvedValueOnce({
      ok: true,
      data: {
        settings: {
          general: {
            petSize: 96,
            petSound: true,
            petIdleTalk: true,
            petAlwaysOnTop: true,
            petTheme: 'sakura',
            petMotion: true,
            petName: '即时助手',
            petClickAction: 'screenshot',
            petDoubleClickAction: 'main',
            petIdleTalkMinutes: 3,
            petSleepMinutes: 5,
            petSoundVolume: 60,
            petSpeechRate: 1
          },
          ai: { preProofread: false },
          search: { verify: true }
        },
        version: '0.38.11'
      }
    } as never);
    render(<PetWindow />);
    // 等设置加载完（apply 是异步的），否则单击动作还是默认值
    await new Promise((resolve) => setTimeout(resolve, 100));
    fireEvent.click(screen.getByTitle(/点击聊天/));
    await vi.waitFor(() => expect(api.captureRegion).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('关闭动效时不给动画类', async () => {
    const { api } = installBsub();
    api.getSettings.mockResolvedValueOnce({
      ok: true,
      data: {
        settings: {
          general: {
            petSize: 96,
            petMotion: false,
            petTheme: 'graphite',
            petName: '即时助手',
            petClickAction: 'chat',
            petDoubleClickAction: 'main',
            petIdleTalk: true,
            petIdleTalkMinutes: 3,
            petSleepMinutes: 5,
            petSound: true,
            petSoundVolume: 60,
            petSpeechRate: 1,
            petAlwaysOnTop: true
          },
          ai: { preProofread: false },
          search: { verify: true }
        },
        version: '0.38.11'
      }
    } as never);
    render(<PetWindow />);
    await waitFor(() => expect(document.querySelector('.pet-root.no-motion')).toBeTruthy());
    expect(document.querySelector('.pet-root.pet-theme-graphite')).toBeTruthy();
  });
});

describe('PetWindow 拖动与 Q 弹', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('在本体上按下会开始拖动，松开结束', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    const body = screen.getByTitle(/点击聊天/);
    fireEvent.mouseDown(body, { button: 0, screenX: 100, screenY: 100 });
    expect(api.beginPetDrag).toHaveBeenCalled();
    expect(document.querySelector('.pet-root.is-pressing')).toBeTruthy();

    fireEvent.mouseUp(window, { screenX: 104, screenY: 100 });
    await waitFor(() => expect(api.endPetDrag).toHaveBeenCalled());
    expect(document.querySelector('.pet-root.is-pressing')).toBeNull();
  });

  it('在气泡里按下不会触发拖动', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.mouseDown(input, { button: 0, screenX: 10, screenY: 10 });
    expect(api.beginPetDrag).not.toHaveBeenCalled();
  });

  it('拖动超过阈值时进入拖动态（轻微倾斜）', async () => {
    installBsub();
    render(<PetWindow />);
    const body = screen.getByTitle(/点击聊天/);
    fireEvent.mouseDown(body, { button: 0, screenX: 100, screenY: 100 });
    fireEvent.mouseMove(window, { screenX: 130, screenY: 140 });
    await waitFor(() => expect(document.querySelector('.pet-root.is-dragging')).toBeTruthy());
    fireEvent.mouseUp(window, { screenX: 130, screenY: 140 });
  });
});

describe('PetWindow 操作优化', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('单击在 150ms 内展开（给双击留判定窗口）', async () => {
    installBsub();
    render(<PetWindow />);
    fireEvent.click(screen.getByTitle(/点击聊天/));
    expect(await screen.findByPlaceholderText(/问点什么/)).toBeTruthy();
  });

  it('草稿在重开/重启后还在', async () => {
    installBsub();
    const first = render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '没发出去的草稿' } });
    await new Promise((resolve) => setTimeout(resolve, 260));
    first.unmount();

    installBsub();
    render(<PetWindow />);
    await openBubble();
    expect((screen.getByPlaceholderText(/问点什么/) as HTMLInputElement).value).toBe(
      '没发出去的草稿'
    );
  });

  it('↑ 能翻出上一条问题', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '第一个问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('第一个问题');
  });

  it('「新对话」清空上下文与回答', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '旧问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    const id = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId: id, text: '旧回答', model: 'test' });
    await screen.findByText('旧回答');

    fireEvent.click(screen.getByText('新对话'));
    expect(screen.queryByText('旧回答')).toBeNull();

    fireEvent.change(input, { target: { value: '新问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));
    const payload = lastChatPayload(api);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].content).toBe('新问题');
  });

  it('出错后可以重试上一条', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '会失败的问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    const id = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.error?.({ requestId: id, error: '网络错误' });
    fireEvent.click(await screen.findByText('重试'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));
    expect(lastChatPayload(api).messages[0].content).toBe('会失败的问题');
  });

  it('待办会写进设置文件', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    const todo = screen.getByPlaceholderText(/加一条待办/);
    fireEvent.change(todo, { target: { value: '写周报' } });
    fireEvent.keyDown(todo, { key: 'Enter' });
    await vi.waitFor(
      () => {
        const calls = (api.saveSettings as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        const saved = calls.at(-1)?.[0] as { general?: { petTodos?: unknown[] } };
        expect(saved?.general?.petTodos).toEqual([
          expect.objectContaining({ text: '写周报', done: false })
        ]);
      },
      { timeout: 3000 }
    );
  });
});

describe('PetWindow 点击/失焦', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('打开气泡后焦点直接进输入框', async () => {
    installBsub();
    render(<PetWindow />);
    fireEvent.click(screen.getByTitle(/点击聊天/));
    const input = await screen.findByPlaceholderText(/问点什么/);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('拖动后松手不会误开气泡', async () => {
    installBsub();
    render(<PetWindow />);
    const body = screen.getByTitle(/点击聊天/);
    fireEvent.mouseDown(body, { button: 0, screenX: 100, screenY: 100 });
    fireEvent.mouseUp(window, { screenX: 220, screenY: 160 });
    fireEvent.click(body, { screenX: 220, screenY: 160 });
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
  });

  it('点到别处（窗口失焦）会收起气泡', async () => {
    installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull());
  });
});

describe('PetWindow 气泡尺寸与菜单', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('右键菜单可以切气泡三档尺寸', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('气泡：大窗'));
    await vi.waitFor(() => {
      const calls = (api.saveSettings as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const saved = calls.at(-1)?.[0] as { general?: Record<string, unknown> };
      expect(saved?.general?.petBubbleWidth).toBe(620);
      expect(saved?.general?.petBubbleHeight).toBe(680);
    });
  });

  it('从气泡标题栏也能拖动', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.mouseDown(document.querySelector('.pet-bubble-head') as HTMLElement, {
      button: 0,
      screenX: 100,
      screenY: 100
    });
    expect(api.beginPetDrag).toHaveBeenCalled();
  });

  it('挂件在点别处后也会收起', async () => {
    installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle(/桌面小挂件/));
    expect(screen.getByPlaceholderText(/加一条待办/)).toBeTruthy();
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByPlaceholderText(/加一条待办/)).toBeNull());
  });

  it('右键菜单支持 ↑/↓ 键盘选择', async () => {
    installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    const menu = document.querySelector('.pet-menu') as HTMLElement;
    await waitFor(() => expect(document.activeElement?.textContent).toContain('历史记录'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('截图（框选）');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toContain('隐藏桌宠');
  });
});

describe('PetWindow 上下翻转', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('主进程通知翻转时切到 is-below', async () => {
    const { api } = installBsub();
    const handlers: Array<(below: boolean) => void> = [];
    api.onPetFlipped.mockImplementation((cb: (below: boolean) => void) => {
      handlers.push(cb);
      return () => {};
    });
    api.petFlipped.mockResolvedValue(true as never);
    render(<PetWindow />);
    await waitFor(() => expect(document.querySelector('.pet-root.is-below')).toBeTruthy());
    handlers[0]?.(false);
    await waitFor(() => expect(document.querySelector('.pet-root.is-below')).toBeNull());
  });
});

describe('PetWindow 气泡缩放与渲染', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('点 ⤢ 打开尺寸面板，选预设并应用', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle(/气泡大小/));
    expect(screen.getByText('气泡大小')).toBeTruthy();
    fireEvent.click(screen.getByText('大窗'));
    fireEvent.click(screen.getByText('应用'));
    await vi.waitFor(() =>
      expect(api.resizeBubble).toHaveBeenCalledWith(620, 680, true)
    );
  });

  it('助手回答按 Markdown 渲染', async () => {
    const { api, handlers } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '要点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    const id = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({ requestId: id, text: '**重点** 内容', model: 'test' });
    expect(await screen.findByText('重点')).toBeTruthy();
    expect(document.querySelector('.pet-line.is-assistant strong')).toBeTruthy();
  });

  it('对话不再读取主窗口页面信息（解耦）', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    expect(api.getPageInfo).not.toHaveBeenCalled();
  });
});

describe('PetWindow 对话独立与 OCR 清理', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('对话请求标记 surface=pet，和主窗口区分', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    expect(lastChatPayload(api).surface).toBe('pet');
  });

  it('OCR 回答会去掉引导句和代码块', async () => {
    const { api, handlers } = installBsub();
    api.captureRegion.mockResolvedValueOnce({
      action: 'ocr',
      dataUrl: SHOT,
      width: 200,
      height: 120
    } as never);
    render(<PetWindow />);
    await openBubble();
    fireEvent.click(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字'));
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    const id = ((api.chat.mock.calls[0] as unknown[])[0] as { requestId: string }).requestId;
    handlers.done?.({
      requestId: id,
      text: ['以下是从图片中提取的文字：', '```', '你好世界', '第二行', '```'].join(
        String.fromCharCode(10)
      ),
      model: 'test'
    });
    expect(await screen.findByText(/你好世界/)).toBeTruthy();
    expect(screen.queryByText(/以下是从图片中提取的文字/)).toBeNull();
  });
});

describe('PetWindow 按钮可配置', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('只渲染设置里勾选的按钮', async () => {
    const { api } = installBsub();
    api.getSettings.mockResolvedValueOnce({
      ok: true,
      data: {
        settings: {
          general: {
            petSize: 96,
            petSound: true,
            petIdleTalk: true,
            petAlwaysOnTop: true,
            petTheme: 'sakura',
            petMotion: true,
            petName: '即时助手',
            petClickAction: 'chat',
            petDoubleClickAction: 'main',
            petIdleTalkMinutes: 3,
            petSleepMinutes: 5,
            petSoundVolume: 60,
            petSpeechRate: 1,
            petButtons: ['screenshot', 'web']
          },
          ai: { preProofread: false },
          search: { verify: true }
        },
        version: '0.38.13'
      }
    } as never);
    render(<PetWindow />);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await openBubble();
    expect(screen.getByTitle('框选屏幕区域，再选识别图片 / 对话 / 提取文字')).toBeTruthy();
    expect(screen.getByTitle(/联网/)).toBeTruthy();
    expect(screen.queryByText('解释选中')).toBeNull();
    expect(screen.queryByText('翻译选中')).toBeNull();
    expect(screen.queryByTitle('把回答复制到剪贴板')).toBeNull();
    expect(screen.queryByTitle(/朗读回答/)).toBeNull();
    expect(screen.queryByTitle(/桌面小挂件/)).toBeNull();
  });
});

describe('PetWindow 自由缩放', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('拖手柄实时改尺寸并落盘', async () => {
    const { api } = installBsub();
    render(<PetWindow />);
    await openBubble();
    const grip = document.querySelector('.pet-resize') as HTMLElement;
    fireEvent.mouseDown(grip, { button: 0, screenX: 500, screenY: 500 });
    fireEvent.mouseMove(window, { screenX: 560, screenY: 460 });
    await waitFor(() => expect(api.resizeBubble).toHaveBeenCalledWith(500, 520, false));
    expect(document.querySelector('.pet-size-badge')?.textContent).toContain('500 × 520');
    fireEvent.mouseUp(window, { screenX: 560, screenY: 460 });
    await waitFor(() => expect(api.resizeBubble).toHaveBeenLastCalledWith(500, 520, true));
  });
});

describe('PetWindow 快捷键/右键/拖文件', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('全局对话快捷键打开气泡并把焦点放进输入框', async () => {
    const { handlers } = installBsub();
    render(<PetWindow />);
    await waitFor(() => expect(handlers.chat).toBeTruthy());
    handlers.chat?.();
    const input = await screen.findByPlaceholderText(/问点什么/);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('全局语音快捷键会请求麦克风，关闭气泡会停止录音', async () => {
    const { handlers } = installBsub();
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    });
    const previous = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    class FakeRecorder {
      state = 'inactive';
      ondataavailable: ((event: unknown) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
    try {
      render(<PetWindow />);
      await waitFor(() => expect(handlers.voice).toBeTruthy());
      handlers.voice?.();
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTitle(/关闭对话/)).toBeTruthy());
      fireEvent.click(screen.getByTitle(/关闭对话/));
      await waitFor(() => expect(track.stop).toHaveBeenCalled());
    } finally {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = previous;
    }
  });

  it('输入框里右键不弹桌宠菜单', async () => {
    installBsub();
    render(<PetWindow />);
    await openBubble();
    fireEvent.contextMenu(screen.getByPlaceholderText(/问点什么/));
    expect(screen.queryByText('历史记录')).toBeNull();
    expect(screen.getByPlaceholderText(/问点什么/)).toBeTruthy();
  });

  it('菜单打开时点本体只收起菜单，不展开气泡', async () => {
    installBsub();
    render(<PetWindow />);
    const body = screen.getByTitle(/点击聊天/);
    fireEvent.contextMenu(body);
    expect(screen.getByText('历史记录')).toBeTruthy();
    fireEvent.click(body);
    await waitFor(() => expect(screen.queryByText('历史记录')).toBeNull());
    expect(screen.queryByPlaceholderText(/问点什么/)).toBeNull();
  });
});

describe('PetWindow 历史', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('右键历史记录可以搜索旧对话', async () => {
    localStorage.setItem(
      'pet-history',
      JSON.stringify([{ role: 'user', text: '老问题' }, { role: 'assistant', text: '老回答' }])
    );
    installBsub();
    render(<PetWindow />);
    fireEvent.contextMenu(screen.getByTitle(/点击聊天/));
    fireEvent.click(screen.getByText('历史记录'));
    expect(await screen.findByPlaceholderText('搜索历史…')).toBeTruthy();
    const input = screen.getByPlaceholderText('搜索历史…');
    fireEvent.change(input, { target: { value: '老回答' } });
    const items = [...document.querySelectorAll('.pet-history-item')].map(
      (el) => el.textContent || ''
    );
    expect(items.some((text) => text.includes('老回答'))).toBe(true);
    expect(items.some((text) => text.includes('老问题'))).toBe(false);
  });
});
