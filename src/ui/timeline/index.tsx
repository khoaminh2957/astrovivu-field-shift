/** PLACEHOLDER (owner: Agent 4a). State 4: Master Timeline Scrubber with playback and automatic commentary. */
import { pick } from '@/contracts';
import { insightsNear } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { box, btn } from '../_placeholder';

export function TimelineScrubber() {
  const { timeline, setCursor, play, pause, insights, lang } = useMission();
  const span = diffDays(timeline.end, timeline.start);
  const near = insightsNear(insights, timeline.cursor);
  return (
    <div style={{ ...box, left: 8, right: 8, bottom: 8 }} data-placeholder="timeline">
      <button style={btn} onClick={timeline.playing ? pause : play}>{timeline.playing ? 'pause' : 'play'}</button>
      {timeline.cursor}
      <input
        type="range"
        min={0}
        max={span}
        value={diffDays(timeline.cursor, timeline.start)}
        onChange={(e) => setCursor(addDays(timeline.start, Number(e.target.value)))}
        style={{ width: '70%', marginLeft: 12 }}
      />
      <div>{near.map((i) => pick(i.text, lang)).join(' · ') || 'no commentary for this date'}</div>
    </div>
  );
}
