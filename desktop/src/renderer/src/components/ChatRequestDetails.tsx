import type { ChatMessage } from '../../../shared/types';

/** 单条助手回答的请求详情，独立于消息列表渲染。 */
export function ChatRequestDetails({ message }: { message: ChatMessage }) {
  const sourceCount = (message.sources || []).filter((source) =>
    /^https?:\/\//i.test(source.url)
  ).length;
  return (
    <div className="chat-request-details">
      <div className="chat-detail-row">
        <span>模型</span>
        <b>{message.model || '未知'}</b>
      </div>
      <div className="chat-detail-row">
        <span>联网</span>
        <b>{message.webEngine || '未联网'}</b>
      </div>
      <div className="chat-detail-row">
        <span>来源 / 工具</span>
        <b>
          {sourceCount} 条 / {message.tools?.length || 0} 次
        </b>
      </div>
      {message.usage && (
        <div className="chat-detail-row">
          <span>Token</span>
          <b>
            入 {message.usage.inputTokens.toLocaleString('zh-CN')} · 出{' '}
            {message.usage.outputTokens.toLocaleString('zh-CN')}
            {message.usage.cacheReadTokens
              ? ` · 缓存 ${message.usage.cacheReadTokens.toLocaleString('zh-CN')}`
              : ''}
          </b>
        </div>
      )}
      {typeof message.elapsedMs === 'number' && (
        <div className="chat-detail-row">
          <span>耗时</span>
          <b>{(message.elapsedMs / 1000).toFixed(1)}s</b>
        </div>
      )}
      {message.webNotice && (
        <div className="chat-detail-notice">{message.webNotice}</div>
      )}
    </div>
  );
}
