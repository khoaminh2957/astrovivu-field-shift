/** PLACEHOLDER (owner: Agent 4a). State 2: layer toggles and the Bottom Action Dock (parcel definition). */
import type { BaseLayerId, OverlayId } from '@/contracts';
import { SAMPLE_PARCELS } from '@/data';
import { useMission } from '@/state/mission';
import { box, btn } from '../_placeholder';

const BASE: BaseLayerId[] = ['satellite', 'terrain', 'labels'];
const OVERLAYS: OverlayId[] = ['none', 'truecolor', 'ndvi', 'soilMoisture', 'rain', 'lst'];

export function LayerPanel() {
  const { layers, setBaseLayer, setOverlay } = useMission();
  return (
    <div style={{ ...box, top: 60, right: 8 }} data-placeholder="layers">
      {BASE.map((id) => (
        <label key={id} style={{ display: 'block' }}>
          <input type="checkbox" checked={layers.base[id]} onChange={(e) => setBaseLayer(id, e.target.checked)} /> {id}
        </label>
      ))}
      <select value={layers.overlay} onChange={(e) => setOverlay(e.target.value as OverlayId)}>
        {OVERLAYS.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function ActionDock() {
  const { lockSample, startDraw, drawMode, cancelDraw } = useMission();
  return (
    <div style={{ ...box, bottom: 12, left: '50%', transform: 'translateX(-50%)' }} data-placeholder="dock">
      {SAMPLE_PARCELS.map((p) => (
        <button key={p.id} style={btn} onClick={() => void lockSample(p.id)}>{p.name}</button>
      ))}
      <br />
      <button style={btn} onClick={() => startDraw('quad')}>draw 4 corners</button>
      <button style={btn} onClick={() => startDraw('coords')}>coordinates + area</button>
      <button style={btn} onClick={() => startDraw('gps')}>my location</button>
      {drawMode && <button style={btn} onClick={cancelDraw}>cancel ({drawMode})</button>}
    </div>
  );
}
