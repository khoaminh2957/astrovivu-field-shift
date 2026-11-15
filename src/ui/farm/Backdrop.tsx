/**
 * What stands behind the field in the farm scene: the sky of the day, the sun, clouds, a far
 * range, two hills, trees, the farmstead with its wind pump, and the fence along the field. The
 * sky follows the day's readings (`SkyKind`); the land is decoration and stands for no data.
 */
import type { SkyKind } from '@/core/farm';

const W = 560;

export const SKY: Record<SkyKind, { veil: number; sun: number; clouds: number; rain: number; cloudFill: string; cloudShade: string }> = {
  clear: { veil: 0, sun: 1, clouds: 0.7, rain: 0, cloudFill: '#ffffff', cloudShade: '#dcebf7' },
  cloudy: { veil: 0.4, sun: 0.3, clouds: 1, rain: 0, cloudFill: '#f1f4f7', cloudShade: '#cfd8e1' },
  rain: { veil: 0.62, sun: 0, clouds: 1, rain: 0.75, cloudFill: '#c5ced8', cloudShade: '#9eabb9' },
  'heavy-rain': { veil: 0.85, sun: 0, clouds: 1, rain: 1, cloudFill: '#98a5b4', cloudShade: '#76869a' },
  hot: { veil: 0, sun: 1, clouds: 0.14, rain: 0, cloudFill: '#ffffff', cloudShade: '#f7e7c8' },
  frost: { veil: 0.08, sun: 0.75, clouds: 0.4, rain: 0, cloudFill: '#ffffff', cloudShade: '#dfeaf6' },
  unknown: { veil: 0.3, sun: 0, clouds: 0.4, rain: 0, cloudFill: '#e4e8ed', cloudShade: '#cdd4dc' },
};

function Tree({ x, y, s = 1, tone = 0 }: { x: number; y: number; s?: number; tone?: 0 | 1 | 2 }) {
  const fill = ['#3f9a57', '#55ad62', '#2f8650'][tone];
  const light = ['#63bd72', '#7cc983', '#4da066'][tone];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={2} cy={7} rx={13} ry={3} fill="#000" opacity={0.12} />
      <rect x={-2} y={-8} width={4} height={15} rx={1.5} fill="#7a5230" />
      <circle cx={-8} cy={-13} r={9.5} fill={fill} />
      <circle cx={8} cy={-12} r={9} fill={fill} />
      <circle cx={0} cy={-21} r={12} fill={fill} />
      <circle cx={-4} cy={-24} r={7} fill={light} />
      <circle cx={-10} cy={-15} r={4.5} fill={light} opacity={0.8} />
    </g>
  );
}

/** A slim tree, for rhythm among the round ones. */
function Poplar({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-1.5} y={-4} width={3} height={10} fill="#7a5230" />
      <path d="M 0 -44 Q 9 -26 6 -6 Q 0 -1 -6 -6 Q -9 -26 0 -44 Z" fill="#3c8f5a" />
      <path d="M 0 -44 Q -9 -26 -6 -6 Q -2 -20 0 -44 Z" fill="#58ad6e" />
    </g>
  );
}

function Cloud({ y, s, fill, shade }: { y: number; s: number; fill: string; shade: string }) {
  return (
    <g transform={`translate(0 ${y}) scale(${s})`}>
      <ellipse className="farm-fade" cx={46} cy={16} rx={40} ry={9} fill={shade} />
      <g className="farm-fade" fill={fill}>
        <ellipse cx={42} cy={10} rx={36} ry={12} />
        <ellipse cx={22} cy={5} rx={18} ry={13} />
        <ellipse cx={52} cy={-1} rx={23} ry={17} />
        <ellipse cx={76} cy={8} rx={17} ry={11} />
      </g>
    </g>
  );
}

export function Backdrop({ kind, windy }: { kind: SkyKind; windy: boolean }) {
  const sky = SKY[kind];
  return (
    <g data-farm="backdrop">
      <defs>
        <linearGradient id="farm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#62b2ee" />
          <stop offset="0.55" stopColor="#a8dbf6" />
          <stop offset="1" stopColor="#eaf8fb" />
        </linearGradient>
        <linearGradient id="farm-veil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#55647a" />
          <stop offset="1" stopColor="#a9b6c3" />
        </linearGradient>
        <radialGradient id="farm-glow">
          <stop offset="0" stopColor="#fff6c2" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff6c2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="farm-range" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fb0d2" />
          <stop offset="1" stopColor="#cfe2ee" />
        </linearGradient>
        <linearGradient id="farm-hill-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe6ae" />
          <stop offset="1" stopColor="#8fcf8e" />
        </linearGradient>
        <linearGradient id="farm-hill-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd486" />
          <stop offset="1" stopColor="#5fb565" />
        </linearGradient>
      </defs>

      {/* Sky: the clear sky, and a veil for each kind of day laid over it. */}
      <rect width={W} height={240} fill="url(#farm-sky)" />
      <rect className="farm-fade" width={W} height={240} fill="url(#farm-veil)" opacity={sky.veil} />
      <rect className="farm-fade" width={W} height={240} fill="#ffb24d" opacity={kind === 'hot' ? 0.28 : 0} />
      <rect className="farm-fade" width={W} height={240} fill="#eef5ff" opacity={kind === 'frost' ? 0.55 : 0} />

      <g className="farm-fade" opacity={sky.sun} data-farm="sun">
        <circle cx={392} cy={60} r={kind === 'hot' ? 92 : 70} fill="url(#farm-glow)" />
        <g className="farm-sun-rays">
          {Array.from({ length: 12 }, (_, k) => (
            <line key={k} x1={392 + 31 * Math.cos((k * Math.PI) / 6)} y1={60 + 31 * Math.sin((k * Math.PI) / 6)} x2={392 + 42 * Math.cos((k * Math.PI) / 6)} y2={60 + 42 * Math.sin((k * Math.PI) / 6)} stroke="#ffe08a" strokeWidth={3} strokeLinecap="round" />
          ))}
        </g>
        <circle cx={392} cy={60} r={kind === 'hot' ? 26 : 22} fill={kind === 'hot' ? '#ffac2b' : '#ffd24a'} />
        <circle cx={385} cy={53} r={kind === 'hot' ? 12 : 10} fill="#fff" opacity={0.25} />
      </g>

      {/* A far range, pale with distance. */}
      <path d="M 0 178 L 46 140 L 84 158 L 142 116 L 196 156 L 236 138 L 292 168 L 352 126 L 404 160 L 452 132 L 510 158 L 560 134 V 230 H 0 Z" fill="url(#farm-range)" opacity={0.85} />
      <path d="M 142 116 L 156 132 L 146 130 L 138 140 L 128 128 Z M 352 126 L 366 142 L 354 139 L 346 148 L 338 137 Z" fill="#fff" opacity={0.7} />

      <g className="farm-fade" opacity={sky.clouds} data-farm="clouds">
        {[
          { y: 30, s: 1 },
          { y: 66, s: 0.72 },
          { y: 92, s: 0.55 },
          { y: 46, s: 0.86 },
        ].map((c, k) => (
          <g key={k} className="farm-cloud">
            <Cloud y={c.y} s={c.s} fill={sky.cloudFill} shade={sky.cloudShade} />
          </g>
        ))}
      </g>

      {/* The far hill with its patchwork of fields, then the trees on its crest. */}
      <path d="M 0 192 Q 80 156 176 178 T 372 172 T 560 162 V 240 H 0 Z" fill="url(#farm-hill-far)" />
      <g opacity={0.55}>
        <path d="M 236 178 L 286 172 L 300 188 L 246 194 Z" fill="#e6d98a" />
        <path d="M 300 188 L 286 172 L 336 172 L 356 186 Z" fill="#a7d98f" />
        <path d="M 396 176 L 446 170 L 468 184 L 414 190 Z" fill="#d9e59a" />
        <path d="M 240 181 L 292 175 M 243 185 L 295 180 M 245 190 L 298 185 M 400 179 L 452 173 M 404 184 L 458 178" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} fill="none" />
      </g>
      <Poplar x={22} y={186} s={0.8} />
      <Tree x={44} y={184} s={0.8} tone={2} />
      <Tree x={226} y={180} s={0.6} tone={1} />
      <Poplar x={246} y={179} s={0.6} />
      <Tree x={372} y={174} s={0.62} tone={0} />
      <Tree x={548} y={166} s={0.85} tone={2} />
      <Poplar x={528} y={168} s={0.75} />

      {/* The near meadow, the farmstead on it. */}
      <path d="M 0 210 Q 130 186 292 202 T 560 198 V 262 H 0 Z" fill="url(#farm-hill-near)" />
      <Tree x={70} y={200} s={1} tone={0} />
      <Tree x={214} y={198} s={0.9} tone={1} />
      <Tree x={500} y={198} s={1} tone={0} />
      <Tree x={474} y={202} s={0.7} tone={1} />

      <g data-farm="store">
        <ellipse cx={150} cy={204} rx={52} ry={4} fill="#000" opacity={0.12} />
        {/* Silo. */}
        <rect x={178} y={160} width={17} height={43} fill="#e3e8ee" />
        <rect x={188} y={160} width={7} height={43} fill="#c6cfd9" />
        <path d="M 178 160 Q 186.5 146 195 160 Z" fill="#b3bdc9" />
        <path d="M 178 172 H 195 M 178 184 H 195" stroke="#b3bdc9" strokeWidth={1} />
        {/* Barn: a cream wall, a green roof with its shaded side, a braced door. */}
        <rect x={112} y={170} width={62} height={33} fill="#fff4dc" />
        <rect x={143} y={170} width={31} height={33} fill="#f1e2c2" />
        <path d="M 116 170 V 203 M 122 170 V 203 M 128 170 V 203 M 134 170 V 203 M 150 170 V 203 M 158 170 V 203 M 166 170 V 203" stroke="#e2d0a8" strokeWidth={0.8} />
        <polygon points="104,172 143,142 182,172" fill="#2f8f7a" />
        <polygon points="143,142 182,172 143,172" fill="#257565" />
        <polygon points="104,172 143,142 143,147 110,172" fill="#4fb39c" />
        <rect x={133} y={182} width={20} height={21} fill="#a9683a" />
        <path d="M 133 182 L 153 203 M 153 182 L 133 203 M 143 182 V 203" stroke="#fff4dc" strokeWidth={1.3} />
        <rect x={118} y={178} width={9} height={8} fill="#bfe6f5" stroke="#e2d0a8" />
        <circle cx={143} cy={160} r={4.5} fill="#bfe6f5" stroke="#fff4dc" strokeWidth={1.2} />
      </g>

      {/* A wind pump: its wheel turns, faster on a windy day. */}
      <g data-farm="windpump" transform="translate(440 204)">
        <path d="M -6 0 L 0 -38 L 6 0 M -4 -13 H 4 M -2.5 -26 H 2.5" fill="none" stroke="#8a95a3" strokeWidth={1.4} />
        <g className="farm-wheel" style={{ animationDuration: windy ? '1.2s' : '5s' }}>
          <circle cx={0} cy={-38} r={11} fill="none" stroke="#c6cfd9" strokeWidth={1} />
          {Array.from({ length: 8 }, (_, k) => (
            <path key={k} d="M 0 -38 L 3 -48.5 L -3 -48.5 Z" fill="#dfe5ec" stroke="#aab4c0" strokeWidth={0.5} transform={`rotate(${k * 45} 0 -38)`} />
          ))}
        </g>
        <circle cx={0} cy={-38} r={1.8} fill="#8a95a3" />
      </g>

      {/* Fence along the far edge of the field. */}
      <g stroke="#f4ead2" strokeLinecap="round">
        <path d="M 78 201 H 482 M 78 205.5 H 482" strokeWidth={1.4} />
        {Array.from({ length: 16 }, (_, k) => (
          <line key={k} x1={80 + k * 26.8} y1={197.5} x2={80 + k * 26.8} y2={208} strokeWidth={2} />
        ))}
      </g>
    </g>
  );
}

/** Grass and flowers on the verges beside the field, in front of the rows' ends. */
export function Verges() {
  const tuft = (x: number, y: number, s: number, k: number) => (
    <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M -5 0 Q -6 -7 -8 -10 M -1 0 Q -1 -8 -2 -12 M 3 0 Q 4 -7 7 -10" fill="none" stroke="#3f9a57" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
  const flower = (x: number, y: number, fill: string, k: number) => (
    <g key={`f${k}`} transform={`translate(${x} ${y})`}>
      <path d="M 0 0 V -7" stroke="#3f9a57" strokeWidth={1.4} />
      <circle cx={0} cy={-9} r={2.6} fill={fill} />
      <circle cx={0} cy={-9} r={1} fill="#fff7c9" />
    </g>
  );
  return (
    <g data-farm="verges">
      {[
        [16, 236, 0.8],
        [38, 226, 0.7],
        [10, 250, 1],
        [544, 238, 0.8],
        [524, 228, 0.7],
        [552, 250, 1],
      ].map(([x, y, s], k) => tuft(x, y, s, k))}
      {flower(26, 240, '#ffffff', 0)}
      {flower(48, 222, '#ffd24a', 1)}
      {flower(536, 244, '#ff9db4', 2)}
      {flower(514, 224, '#ffffff', 3)}
    </g>
  );
}
