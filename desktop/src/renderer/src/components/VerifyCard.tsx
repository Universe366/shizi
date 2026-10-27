import type { VerificationSummary } from '../../../shared/types';

interface VerifyCardProps {
  verification: VerificationSummary;
}

/** 解释“为什么没有证据”：把失败、丢弃、无可核实项区分开。 */
function emptyReason(
  attempted: number,
  failed: number,
  dropped: number,
  references: number,
  items: VerificationSummary['items'],
  judged: boolean
): string {
  if (attempted === 0 && items.length === 0) {
    return '没有从字幕里抽到可核实项（纯观点或口语内容通常不会被核对）。';
  }
  if (failed > 0 && failed >= attempted) {
    return `检索全部失败（${failed}/${attempted}）：检查设置里的检索平台、Key 或网络后重新生成。`;
  }
  if (references === 0 && dropped > 0 && judged) {
    return `检索到证据，但都被判定为无关（丢弃 ${dropped} 条）。`;
  }
  if (references === 0) {
    return '本次没有取得可用证据。';
  }
  return '';
}

/** 本次联网核对：检索词 → 字幕原句 → 证据列表，逐条标注支持/反驳/未判定。 */
export function VerifyCard({ verification }: VerifyCardProps) {
  // 老版本/异常写入的 verification 可能缺字段，先归一化，避免整页白屏。
  const data = (verification || {}) as Partial<VerificationSummary>;
  const items = Array.isArray(data.items) ? data.items : [];
  const references = Array.isArray(data.references) ? data.references : [];
  const supplements = Array.isArray(data.supplements) ? data.supplements : [];
  const attempted = Number(data.attempted) || 0;
  const failed = Number(data.failed) || 0;
  const dropped = Number(data.dropped) || 0;
  const judged = data.judged === true;
  const error = typeof data.error === 'string' ? data.error : '';
  const note = typeof data.note === 'string' ? data.note : '';
  const engine = typeof data.engine === 'string' ? data.engine : '';
  const reason = emptyReason(attempted, failed, dropped, references.length, items, judged);
  const hasProblem = Boolean(error) || failed > 0 || references.length === 0;

  return (
    <details className="verify-card" open={hasProblem}>
      <summary className="verify-head">
        <span>本次联网核对</span>
        <span className="verify-stats">
          {attempted} 项 · {references.length} 条证据
          {failed > 0 ? ` · 失败 ${failed}` : ''}
          {judged ? ` · 丢弃 ${dropped}` : ' · 未判定'}
        </span>
      </summary>

      <div className="verify-diag">
        <span>检索：{engine || '默认平台'}</span>
        <span>判定：{judged ? '已完成' : '未完成'}</span>
        {dropped > 0 && <span>判定丢弃：{dropped}</span>}
      </div>

      {error ? (
        <div className="verify-error">核对失败：{error}</div>
      ) : failed > 0 ? (
        <div className="verify-error">
          有 {failed} 项检索失败；可检查设置里的检索平台、Key 或网络后重新生成。
        </div>
      ) : null}
      {note ? (
        <div className="verify-note">{note}</div>
      ) : !judged ? (
        <div className="verify-note">
          本次未完成语义判定，证据只按词面与域名粗标；结论仅供参考。
        </div>
      ) : null}

      {reason && !error && <div className="verify-none">{reason}</div>}

      {supplements.length > 0 && (
        <div className="verify-supplements">
          {supplements.map((item, index) => (
            <div key={`${index}-${String(item).slice(0, 8)}`}>+ {item}</div>
          ))}
        </div>
      )}

      <div className="verify-list">
        {items.map((item, index) => {
          const refs = Array.isArray(item.references) ? item.references : [];
          return (
            <div key={`${index}-${item.query}`} className="verify-item">
              <div className="verify-query">
                {item.label || item.query || '未命名核实项'}
                <span className="verify-line">字幕：{item.line}</span>
                {item.query && item.query !== item.label && (
                  <span className="verify-query-text">检索：{item.query}</span>
                )}
              </div>
              {refs.length === 0 ? (
                <div className="verify-empty">这一项没有检索到证据</div>
              ) : (
                refs.map((reference) => (
                  <button
                    key={reference.url}
                    className="verify-ref"
                    title={reference.url}
                    onClick={() => void window.bsub.newTab(reference.url)}
                  >
                    <span className={`verify-verdict ${reference.verdict || 'unknown'}`}>
                      {reference.verdict === 'support'
                        ? '支持'
                        : reference.verdict === 'refute'
                          ? '反驳'
                          : '未判定'}
                    </span>
                    <span className="verify-title">{reference.title}</span>
                    {reference.site && <span className="verify-site">{reference.site}</span>}
                    {reference.consistency === 'multi' && <span className="verify-tag">多源</span>}
                    {reference.consistency === 'conflict' && (
                      <span className="verify-tag conflict">冲突</span>
                    )}
                  </button>
                ))
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

