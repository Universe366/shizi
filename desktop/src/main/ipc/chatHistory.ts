import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ChatConversation,
  ChatToolRecord,
  Result,
  StoredChatMessage,
  WebReference
} from '../../shared/types';
import {
  appendMessage,
  conversationMarkdown,
  createConversation,
  deleteConversation,
  latestConversationForVideo,
  listConversations,
  listMessages,
  renameConversation,
  setConversationProfile,
  truncateMessages
} from '../chatStore';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

export function registerChatHistoryIpc(): void {
  ipcMain.handle('chat:history-list', (_event, limit: unknown) => {
    try {
      return ok<ChatConversation[]>(listConversations(Number(limit) || 50));
    } catch (error) {
      return failure<ChatConversation[]>(error);
    }
  });

  ipcMain.handle('chat:history-latest', (_event, videoKey: string) => {
    try {
      return ok<ChatConversation | null>(latestConversationForVideo(String(videoKey || '')));
    } catch (error) {
      return failure<ChatConversation | null>(error);
    }
  });

  ipcMain.handle(
    'chat:history-create',
    (_event, input: { title?: string; videoKey?: string; videoTitle?: string; profileId?: string }) => {
      try {
        return ok<ChatConversation>(createConversation(input || {}));
      } catch (error) {
        return failure<ChatConversation>(error);
      }
    }
  );

  ipcMain.handle('chat:history-messages', (_event, id: number) => {
    try {
      return ok<StoredChatMessage[]>(listMessages(Number(id)));
    } catch (error) {
      return failure<StoredChatMessage[]>(error);
    }
  });

  ipcMain.handle(
    'chat:history-append',
    (
      _event,
      payload: {
        conversationId: number;
        message: {
          role: 'user' | 'assistant';
          content: string;
          reasoning?: string;
          model?: string;
          images?: string[];
          sources?: WebReference[];
          webEngine?: string;
          webNotice?: string;
          tools?: ChatToolRecord[];
        };
      }
    ) => {
      try {
        return ok<StoredChatMessage>(
          appendMessage(Number(payload?.conversationId), payload?.message)
        );
      } catch (error) {
        return failure<StoredChatMessage>(error);
      }
    }
  );

  ipcMain.handle(
    'chat:history-rename',
    (_event, payload: { id: number; title: string }) => {
      try {
        return ok(renameConversation(Number(payload?.id), String(payload?.title || '')));
      } catch (error) {
        return failure<boolean>(error);
      }
    }
  );

  ipcMain.handle(
    'chat:history-profile',
    (_event, payload: { conversationId: number; profileId: string }) => {
      try {
        return ok(
          setConversationProfile(
            Number(payload?.conversationId),
            String(payload?.profileId || '')
          )
        );
      } catch (error) {
        return failure<boolean>(error);
      }
    }
  );

  ipcMain.handle(
    'chat:history-truncate',
    (_event, payload: { conversationId: number; keep: number }) => {
      try {
        return ok(
          truncateMessages(Number(payload?.conversationId), Number(payload?.keep) || 0)
        );
      } catch (error) {
        return failure<boolean>(error);
      }
    }
  );

  ipcMain.handle('chat:history-delete', (_event, id: number) => {
    try {
      return ok(deleteConversation(Number(id)));
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('chat:history-export', async (_event, id: number) => {
    try {
      const markdown = conversationMarkdown(Number(id));
      if (!markdown) return ok({ canceled: true });
      const result = await dialog.showSaveDialog({
        title: '导出对话',
        defaultPath: path.join(process.env.USERPROFILE || '', `shizi-chat-${id}.md`),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (result.canceled || !result.filePath) return ok({ canceled: true });
      fs.writeFileSync(result.filePath, markdown, 'utf8');
      return ok({ canceled: false, path: result.filePath });
    } catch (error) {
      return failure<{ canceled: boolean; path?: string }>(error);
    }
  });
}
