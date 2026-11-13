/**
 * NASA AppEEARS point sample of SMAP L4 (SPL4SMGP.008, 3-hourly, 9 km) → daily means.
 * Needs an Earthdata Login bearer token (`EARTHDATA_TOKEN`), so it runs in Node only. Tasks are
 * asynchronous and typically take several minutes; the cache script waits up to 20 minutes.
 *
 * Not verified end-to-end: no token was available while building it (see DATA_SOURCES.md).
 */
import type { LngLat, Sample } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { serverSecret } from '../env';
import { getJson, getText, sleep } from '../http';

const API = 'https://appeears.earthdatacloud.nasa.gov/api';
const mdY = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

export const appeearsAvailable = (): boolean => !!serverSecret('EARTHDATA_TOKEN');

export async function smapL4Point(at: LngLat, start: string, end: string, signal?: AbortSignal): Promise<{ surface: Sample[]; root: Sample[] }> {
  const token = serverSecret('EARTHDATA_TOKEN');
  if (!token) throw new Error('EARTHDATA_TOKEN not set');
  const auth = { Authorization: `Bearer ${token}` };
  return cached(`appeears:spl4:${ck(at[0], 3)},${ck(at[1], 3)}:${start}:${end}`, TTL.day, async () => {
    const task = {
      task_type: 'point',
      task_name: `astrovivu-smap-${Date.now()}`,
      params: {
        dates: [{ startDate: mdY(start), endDate: mdY(end) }],
        layers: [
          { product: 'SPL4SMGP.008', layer: 'Geophysical_Data_sm_surface' },
          { product: 'SPL4SMGP.008', layer: 'Geophysical_Data_sm_rootzone' },
        ],
        coordinates: [{ latitude: at[1], longitude: at[0], id: 'parcel' }],
      },
    };
    const { task_id } = await getJson<{ task_id: string }>(`${API}/task`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
      signal,
      timeoutMs: 60_000,
    });
    const t0 = Date.now();
    for (;;) {
      await sleep(20_000, signal);
      const st = await getJson<{ status: string }>(`${API}/task/${task_id}`, { headers: auth, signal, timeoutMs: 30_000 });
      if (st.status === 'done') break;
      if (st.status === 'error') throw new Error('AppEEARS task failed');
      if (Date.now() - t0 > 20 * 60_000) throw new Error('AppEEARS task still running after 20 min');
    }
    const bundle = await getJson<{ files: { file_id: string; file_name: string }[] }>(`${API}/bundle/${task_id}`, { headers: auth, signal, timeoutMs: 30_000 });
    const f = bundle.files.find((x) => x.file_name.endsWith('.csv') && x.file_name.includes('SPL4SMGP'));
    if (!f) throw new Error('AppEEARS bundle has no SPL4SMGP CSV');
    const csv = await getText(`${API}/bundle/${task_id}/${f.file_id}`, { headers: auth, signal, timeoutMs: 60_000 });
    return parseSmapCsv(csv);
  });
}

/** Average the 3-hourly rows per calendar day. */
export function parseSmapCsv(csv: string): { surface: Sample[]; root: Sample[] } {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const iDate = head.indexOf('Date');
  const iS = head.findIndex((h) => h.endsWith('sm_surface'));
  const iR = head.findIndex((h) => h.endsWith('sm_rootzone'));
  const acc = new Map<string, { s: number; sn: number; r: number; rn: number }>();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const t = (c[iDate] ?? '').slice(0, 10);
    if (!t) continue;
    const a = acc.get(t) ?? { s: 0, sn: 0, r: 0, rn: 0 };
    const s = Number(c[iS]);
    const r = Number(c[iR]);
    if (Number.isFinite(s) && s >= 0 && s <= 1) (a.s += s), a.sn++;
    if (Number.isFinite(r) && r >= 0 && r <= 1) (a.r += r), a.rn++;
    acc.set(t, a);
  }
  const days = [...acc.keys()].sort();
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    surface: days.map((t) => ({ t, v: acc.get(t)!.sn ? r3(acc.get(t)!.s / acc.get(t)!.sn) : null })),
    root: days.map((t) => ({ t, v: acc.get(t)!.rn ? r3(acc.get(t)!.r / acc.get(t)!.rn) : null })),
  };
}
