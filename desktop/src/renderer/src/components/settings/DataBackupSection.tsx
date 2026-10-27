import { useEffect, useState } from 'react';
import { Cloud, Download, FolderOpen, RefreshCw, Upload } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { askConfirm } from '../ui/confirm';

interface DataBackupSectionProps {
  dataDir: string;
  migrating: boolean;
  onChangeLocation: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onCompact: () => void;
  onClearBrowsingData: () => void;
}

/** 数据与备份：目录展示、迁移、设置导入导出、整库备份恢复、压缩、清浏览数据。 */
export function DataBackupSection({
  dataDir,
  migrating,
  onChangeLocation,
  onExportSettings,
  onImportSettings,
  onBackup,
  onRestore,
  onCompact,
  onClearBrowsingData
}: DataBackupSectionProps) {
  const [syncFolder, setSyncFolder] = useState('');
  const [syncHint, setSyncHint] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (!response.ok) return;
      const folder = response.data.settings.general.syncFolder || '';
      setSyncFolder(folder);
      if (folder) {
        void window.bsub.syncStatus(folder).then((status) => {
          if (!status.ok) return;
          setSyncHint(
            status.data.exists
              ? `上次同步：${new Date(status.data.modifiedAt || Date.now()).toLocaleString('zh-CN')}`
              : '同步文件夹里还没有设置文件'
          );
        });
      }
    });
  }, []);

  const saveSyncFolder = async (folder: string) => {
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    settings.general.syncFolder = folder;
    await window.bsub.saveSettings(settings);
  };

  const chooseSyncFolder = async () => {
    const result = await window.bsub.chooseSyncFolder();
    if (!result.ok || !result.data) return;
    setSyncFolder(result.data);
    await saveSyncFolder(result.data);
    setSyncHint('已选择同步文件夹');
  };

  const pushSync = async () => {
    if (!syncFolder.trim()) return;
    setSyncBusy(true);
    const result = await window.bsub.syncPush(syncFolder.trim());
    setSyncBusy(false);
    setSyncHint(
      result.ok
        ? `已上传：${result.data.path}`
        : `上传失败：${result.error || '未知错误'}`
    );
  };

  const pullSync = async () => {
    if (!syncFolder.trim()) return;
    if (
      !(await askConfirm({
        title: '从同步文件夹恢复设置？',
        description: '会覆盖本机设置（API Key 保留本机）。',
        confirmText: '恢复'
      }))
    ) {
      return;
    }
    setSyncBusy(true);
    const result = await window.bsub.syncPull(syncFolder.trim());
    setSyncBusy(false);
    if (!result.ok) {
      setSyncHint(`恢复失败：${result.error || '未知错误'}`);
      return;
    }
    setSyncHint('已恢复，正在刷新…');
    window.setTimeout(() => window.location.reload(), 400);
  };

  return (
    <SettingsSection title="数据与备份" defaultOpen={false}>
      <div className="settings-row">
        <span>数据目录</span>
      </div>
      <div className="settings-path" title={dataDir}>
        {dataDir}
      </div>
      <div className="settings-row">
        <span>数据库</span>
        <code>{dataDir}\library.db</code>
      </div>
      <div className="settings-inline">
        <button className="mini-btn" onClick={() => void window.bsub.openDataDir()}>
          <FolderOpen size={12} /> 打开目录
        </button>
        <button className="mini-btn" onClick={onChangeLocation} disabled={migrating}>
          <FolderOpen size={12} /> {migrating ? '迁移中…' : '更改位置'}
        </button>
        <button className="mini-btn" onClick={onExportSettings}>
          <Download size={12} /> 导出设置
        </button>
        <button className="mini-btn" onClick={onImportSettings}>
          <Upload size={12} /> 导入设置
        </button>
      </div>
      <div className="settings-inline">
        <button className="mini-btn primary" onClick={onBackup}>
          <Download size={12} /> 备份数据
        </button>
        <button className="mini-btn" onClick={onRestore}>
          <Upload size={12} /> 恢复备份
        </button>
        <button className="mini-btn" onClick={onCompact}>
          <RefreshCw size={12} /> 压缩数据库
        </button>
        <button className="mini-btn danger" onClick={onClearBrowsingData}>
          清除浏览数据
        </button>
      </div>
      <div className="settings-label">云同步（网盘文件夹）</div>
      <div className="settings-inline">
        <input
          className="settings-input"
          value={syncFolder}
          placeholder="选择 OneDrive / 坚果云 / Nextcloud 同步目录"
          onChange={(event) => setSyncFolder(event.target.value)}
          onBlur={() => void saveSyncFolder(syncFolder.trim())}
        />
        <button className="mini-btn" onClick={() => void chooseSyncFolder()}>
          <FolderOpen size={12} /> 选择
        </button>
      </div>
      <div className="settings-inline">
        <button
          className="mini-btn"
          disabled={!syncFolder.trim() || syncBusy}
          onClick={() => void pushSync()}
        >
          <Cloud size={12} /> {syncBusy ? '处理中…' : '上传设置'}
        </button>
        <button
          className="mini-btn"
          disabled={!syncFolder.trim() || syncBusy}
          onClick={() => void pullSync()}
        >
          <Download size={12} /> 从同步恢复
        </button>
      </div>
      {syncHint && <div className="settings-hint">{syncHint}</div>}
      <div className="settings-hint">
        同步文件是 shizi-settings.json，由网盘客户端负责多设备同步；不含 API Key / 桥 Token。
      </div>
      <div className="settings-hint">
        更改位置会把设置、字幕库、总结、登录状态和日志复制到新目录，然后自动重启；
        缓存类文件不会复制。日志在数据目录的 logs/ 下（保留 7 天）。
        导出设置与数据备份都不含 API Key / 桥 Token；恢复备份后需要在设置里重新填写 Key，
        桥 Token 会自动重新生成。
      </div>
    </SettingsSection>
  );
}
