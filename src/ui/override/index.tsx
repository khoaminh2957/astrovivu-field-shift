/** PLACEHOLDER (owner: Agent 4a). State 4: Ground-Truth Override (pH, irrigation, crop, sowing date). */
import type { IrrigationMode } from '@/contracts';
import { listCrops } from '@/core/crops';
import { useMission } from '@/state/mission';
import { box } from '../_placeholder';

export function GroundTruthPanel() {
  const { cropId, groundTruth, setCrop, setGroundTruth } = useMission();
  return (
    <div style={{ ...box, bottom: 90, left: '50%', transform: 'translateX(-50%)' }} data-placeholder="override">
      crop{' '}
      <select value={cropId ?? ''} onChange={(e) => setCrop(e.target.value || null)}>
        <option value="">--</option>
        {listCrops().map((c) => <option key={c.id} value={c.id}>{c.names.en}</option>)}
      </select>{' '}
      pH{' '}
      <input type="number" step="0.1" style={{ width: 60 }} value={groundTruth.ph ?? ''} onChange={(e) => setGroundTruth({ ph: e.target.value ? Number(e.target.value) : undefined })} />{' '}
      irrigation{' '}
      <select value={groundTruth.irrigation ?? ''} onChange={(e) => setGroundTruth({ irrigation: (e.target.value || undefined) as IrrigationMode | undefined })}>
        <option value="">--</option>
        <option value="rainfed">rainfed</option>
        <option value="supplemental">supplemental</option>
        <option value="full">full</option>
      </select>{' '}
      sown{' '}
      <input type="date" value={groundTruth.sowingDate ?? ''} onChange={(e) => setGroundTruth({ sowingDate: e.target.value || undefined })} />
    </div>
  );
}
