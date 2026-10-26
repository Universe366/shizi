import type { VerificationSummary } from '../../../shared/types';

interface VerifyCardProps {
  verification: VerificationSummary;
}

/** 本次联网核对：查询 → 字幕原句 → 证据列表，逐条标注支持/反驳/未判定。 */
export function VerifyCard({ verification }: VerifyCardProps) {
  // 老版本/异常写入的 verification 可能缺字段，先归一化，避免整页白屏。
  const data = (verification || {}) as Partial<VerificationSummary>;
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    (item) => item && Array.isArray(item.references) && item.references.length > 0
  );
  const references = Array.isArray(data.references) ? data.references : [];
  const supplements = Array.isArray(data.supplements) ? data.supplements : [];
  const attempted = Number(data.attempted) || 0;
  const failed = Number(data.failed) || 0;
  const dropped = Number(data.dropped) || 0;
  const judged = data.judged === true;
  const error = typeof data.error === 'string' ? data.error : '';
  const note = typeof data.note === 'string' ? data.note : '';

  return (
    <details className="verify-card">
      <summary className="verify-head">
        <span>本次联网核对</span>
        <span className="verify-stats">
          {attempted} 项 · {references.length} 条证据
          {judged ? ` · 丢弃 ${dropped}` : ' · 未判定'}
        </span>
      </summary>
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
        <div className="verify-note">本次未完成语义判定，证据只按词面与域名粗标。</div>
      ) : null}
      {supplements.length > 0 && (
        <div className="verify-supplements">
          {supplements.map((item, index) => (
            <div key={`${index}-${String(item).slice(0, 8)}`}>+ {item}</div>
          ))}
        </div>
      )}
      <div className="verify-list">
        {items.length === 0 && <div className="verify-none">本次没有取得可用证据</div>}
        {items.map((item, index) => (
          <div key={`${index}-${item.query}`} className="verify-item">
            <div className="verify-query">
              {item.label || item.query}
              <span className="verify-line">字幕：{item.line}</span>
              {item.query && item.query !== item.label && (
                <span className="verify-query-text">检索：{item.query}</span>
              )}
            </div>
            {(item.references || []).map((reference) => (
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
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
