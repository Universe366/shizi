import type { ChatApprovalEvent, McpElicitationAction, McpElicitationRequest } from '../../../shared/types';
import { describeMcpParameters } from '../../../shared/mcpSchema';

interface Props {
  approvals: ChatApprovalEvent[];
  elicitations: McpElicitationRequest[];
  elicitValues: Record<string, Record<string, string | boolean>>;
  onApproval: (approval: ChatApprovalEvent, allow: boolean) => void;
  onElicitValues: (
    updater: (
      previous: Record<string, Record<string, string | boolean>>
    ) => Record<string, Record<string, string | boolean>>
  ) => void;
  onReply: (request: McpElicitationRequest, action: McpElicitationAction) => void;
}

/** 工具执行审批与 MCP 补充信息卡片。 */
export function ChatApprovals({
  approvals,
  elicitations,
  elicitValues,
  onApproval,
  onElicitValues,
  onReply
}: Props) {
  return (
    <>
      {approvals.length > 0 && (
        <div className="chat-approval-list">
          {approvals.map((approval) => (
            <div key={approval.approvalId} className="chat-approval-card">
              <div className="chat-approval-title">
                工具「{approval.name}」请求执行，是否允许？
              </div>
              <pre className="chat-approval-args">{approval.detail || '{}'}</pre>
              <div className="chat-approval-actions">
                <button className="mini-btn primary" onClick={() => onApproval(approval, true)}>
                  允许
                </button>
                <button className="mini-btn" onClick={() => onApproval(approval, false)}>
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {elicitations.length > 0 && (
        <div className="chat-approval-list">
          {elicitations.map((request) => {
            const params = describeMcpParameters(request.requestedSchema);
            const values = elicitValues[request.requestId] || {};
            const missing = params.some(
              (param) =>
                param.required && (values[param.name] === undefined || values[param.name] === '')
            );
            return (
              <div key={request.requestId} className="chat-approval-card">
                <div className="chat-approval-title">
                  MCP「{request.serverName}」请求补充信息
                </div>
                <div className="chat-tool-detail">{request.message}</div>
                {params.length ? (
                  params.map((param) => (
                    <label key={param.name} className="chat-elicit-field">
                      <span>
                        {param.name}
                        {param.required ? ' *' : ''} <em>{param.type}</em>
                      </span>
                      {param.enumValues.length ? (
                        <select
                          className="settings-input"
                          value={String(values[param.name] ?? '')}
                          onChange={(event) =>
                            onElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.value
                              }
                            }))
                          }
                        >
                          <option value="">请选择</option>
                          {param.enumValues.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      ) : param.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(values[param.name])}
                          onChange={(event) =>
                            onElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.checked
                              }
                            }))
                          }
                        />
                      ) : (
                        <input
                          className="settings-input"
                          type={param.type.includes('number') ? 'number' : 'text'}
                          value={String(values[param.name] ?? '')}
                          onChange={(event) =>
                            onElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.value
                              }
                            }))
                          }
                        />
                      )}
                      {param.description && <small>{param.description}</small>}
                    </label>
                  ))
                ) : (
                  <div className="settings-hint">这个请求没有额外字段，确认后提交即可。</div>
                )}
                <div className="chat-approval-actions">
                  <button
                    className="mini-btn primary"
                    disabled={missing}
                    onClick={() => onReply(request, 'accept')}
                  >
                    提交
                  </button>
                  <button className="mini-btn" onClick={() => onReply(request, 'decline')}>
                    拒绝
                  </button>
                  <button className="mini-btn" onClick={() => onReply(request, 'cancel')}>
                    取消
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
