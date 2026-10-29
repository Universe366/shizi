// 对话历史持久化单测：写入、按视频恢复、清空。
import { indexedDB } from 'fake-indexeddb';

global.indexedDB = indexedDB;
global.chrome = {
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {}
    }
  },
  runtime: { id: 'test-extension' }
};

const { store } = await import('../shizi-extension/src/sidepanel/modules/store.js');
const chat = await import('../shizi-extension/src/sidepanel/modules/chat-store.js');
const storage = await import('../shizi-extension/src/shared/storage.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const videoA = { bvid: 'BV1CHAT00001', cid: 11, page: 1, title: 'A', signature: 'a' };
const videoB = { bvid: 'BV1CHAT00002', cid: 22, page: 1, title: 'B', signature: 'b' };
store.set({ video: videoA, chat: [] });
chat.watchChatPersistence();

store.set({
  chat: [
    { role: 'user', text: '问题 A' },
    { role: 'assistant', text: '回答 A', reasoning: '思考' }
  ]
});
await sleep(750);
const keyA = chat.chatKey(videoA);
const rowA = await storage.chatHistoryGet(keyA);
check('消息写入 IndexedDB', Boolean(rowA) && rowA.messages.length === 2, JSON.stringify(rowA && rowA.messages));
check('过滤流式占位', rowA && rowA.messages.every((m) => m.text || m.reasoning));

// 切到 B，恢复应为空
store.set({ video: videoB, chat: [] });
await chat.loadChatForVideo(videoB);
check('B 没有历史时为空', (store.get().chat || []).length === 0);

// 回到 A，恢复两条
await chat.loadChatForVideo(videoA);
check(
  '回到 A 恢复对话',
  store.get().chat.length === 2 && store.get().chat[1].reasoning === '思考',
  JSON.stringify(store.get().chat)
);

// 清空 A
await chat.clearChatForVideo(videoA);
const rowAfter = await storage.chatHistoryGet(keyA);
check('清空后历史删除', !rowAfter);

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
