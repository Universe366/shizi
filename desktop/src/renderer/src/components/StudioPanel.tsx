import { StudioWorkbench } from './StudioWorkbench';

/** 成片与处理：任务 / 字幕 / 样式 / 合成 / 记录，参考 VideoCaptioner 的工作流。 */
export function StudioPanel() {
  return (
    <div className="studio-page">
      <StudioWorkbench />
    </div>
  );
}
