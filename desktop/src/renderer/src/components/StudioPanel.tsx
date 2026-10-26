import { LocalWorkbench } from './LocalWorkbench';

/** 成片与处理：一条连续流水线，从素材到成片再到记录，不再用左右分栏或步骤页切开。 */
export function StudioPanel() {
  return (
    <div className="studio-pipeline-page">
      <LocalWorkbench />
    </div>
  );
}
