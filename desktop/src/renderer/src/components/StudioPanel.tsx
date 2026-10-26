import { LocalWorkbench } from './LocalWorkbench';
import { RendersPanel } from './RendersPanel';

/** 成片与处理：左侧本地工作流，右侧成片记录，互不挤占。 */
export function StudioPanel() {
  return (
    <div className="studio-split">
      <LocalWorkbench />
      <aside className="studio-renders" aria-label="成片记录">
        <RendersPanel />
      </aside>
    </div>
  );
}
