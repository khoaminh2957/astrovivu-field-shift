import { CloudRain, Droplets, Layers, type LucideIcon, Mountain, Sprout, Sun, Thermometer, TriangleAlert } from 'lucide-react';
import type { BranchId } from '@/contracts';
import { cn } from './cn';
import { BRANCH_VAR } from './tokens';

/** One icon per branch, used everywhere the branch is named (callouts, layer panel, evidence). */
export const BRANCH_ICON: Record<BranchId, LucideIcon> = {
  soilMoisture: Droplets,
  vegetation: Sprout,
  thermal: Thermometer,
  rainfall: CloudRain,
  agromet: Sun,
  terrain: Mountain,
  soil: Layers,
  risk: TriangleAlert,
};

export interface BranchIconProps {
  branch: BranchId;
  size?: number;
  /** Take the branch hue. Off by default: branch colour is for the branch in focus and for data ink. */
  colored?: boolean;
  className?: string;
}

/** Icon convention of the system: lucide, 1.5 px stroke, 16 px in dense rows, 20 px on touch targets. */
export function BranchIcon({ branch, size = 16, colored, className }: BranchIconProps) {
  const Icon = BRANCH_ICON[branch];
  return <Icon size={size} strokeWidth={1.5} aria-hidden className={cn('shrink-0', className)} style={colored ? { color: BRANCH_VAR[branch] } : undefined} />;
}
