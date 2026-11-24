import { Loader2 } from 'lucide-react';
import type { AppSettings, BridgeStatus } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface BridgeSectionProps {
  value: AppSettings['bridge'];
  status: BridgeStatus | null;
  installing: boolean;
  onChange: (next: AppSettings['bridge']) => void;
  onInstall: () => void;
}

/** 插件桥：启用开关、扩展安装、端口与 Token、运行状态。 */
export function BridgeSection({
  value,
  status,
  installing,
  onChange,
  onInstall
}: BridgeSectionProps) {
  return (
    <SettingsSection title="浏览器插件连接" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        启用本机接收
      </label>
      <div className="settings-inline">
        <button className="mini-btn primary" disabled={installing} onClick={onInstall}>
          {installing ? <Loader2 size={12} className="spin" /> : '安装浏览器插件'}
        </button>
        <span className="settings-hint">准备扩展目录并打开浏览器扩展页</span>
      </div>
      <div className="settings-hint">
        扩展会自动发现本机桌面端，一般不需要手动配置端口或 Token；状态如下。
      </div>
      <div className="settings-hint">
        {status?.running
          ? `运行中 · 127.0.0.1:${status.port}`
          : status?.error
            ? `未启动：${status.error}`
            : '未启动'}
      </div>
    </SettingsSection>
  );
}
