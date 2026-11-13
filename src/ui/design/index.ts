/**
 * Astrovivu design system. Import primitives from `@/ui/design`; never from the files directly.
 * Tokens live in tokens.css (CSS variables + Tailwind theme); the API is described in docs/DESIGN.md.
 */
import './strings';

export { cn } from './cn';

// Tokens for code that needs literals (map paint, canvas, motion library).
export {
  BRANCH_HEX,
  BRANCH_RAMP,
  BRANCH_VAR,
  BREAKPOINT,
  COLOR,
  MOTION,
  PROVENANCES,
  RAMPS,
  STATUSES,
  STATUS_VAR,
  Z,
  contrastRatio,
  rampColor,
  severityFromRisk,
} from './tokens';
export type { MapMetric, Ramp, RampMode, Severity, Status } from './tokens';

export { HUD_METRICS, useHudDensity, usePrefersReducedMotion } from './layout';
export type { HudDensity } from './layout';

// Surfaces and structure
export { Panel } from './Panel';
export type { PanelProps } from './Panel';
export { Dialog, Sheet } from './Dialog';
export type { DialogProps, SheetProps } from './Dialog';
export { Popover, Tooltip } from './Tooltip';
export type { PopoverProps, TooltipProps } from './Tooltip';
export { Tabs, TabPanel } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';
export { EmptyState, RampLegend, ScrollArea, Skeleton, SkeletonText, Wordmark } from './Feedback';
export type { EmptyStateProps, RampLegendProps, ScrollAreaProps, SkeletonProps } from './Feedback';

// Controls
export { Button, IconButton } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';
export { Segmented, Toggle } from './Segmented';
export type { SegmentedOption, SegmentedProps, ToggleProps } from './Segmented';
export { Slider } from './Slider';
export type { SliderMarker, SliderProps, SliderRange, SliderTick } from './Slider';
export { Field, Input, Select, Textarea } from './Field';
export type { ControlSize, FieldProps, InputProps, SelectOption, SelectProps, TextareaProps } from './Field';

// Data honesty
export { ProvenanceTag, StatusGlyph, StatusTag, Tag } from './Tag';
export type { ProvenanceTagProps, StatusGlyphProps, StatusTagProps, TagProps, TagTone } from './Tag';
export { ConfidenceBadge, ConfidenceBars, confidenceLevel } from './ConfidenceBadge';
export type { ConfidenceBadgeProps, ConfidenceLevel } from './ConfidenceBadge';
export { AnomalyGlyph, AnomalyMarker } from './AnomalyMarker';
export type { AnomalyGlyphProps, AnomalyMarkerProps } from './AnomalyMarker';

// Telemetry instruments
export { Sparkline } from './Sparkline';
export type { SparkAnomaly, SparklineProps } from './Sparkline';
export { HubGauge, hubStatus } from './HubGauge';
export type { HubGaugeProps, HubStatus } from './HubGauge';
export { Callout, CalloutFacts } from './Callout';
export type { CalloutFact, CalloutProps } from './Callout';
export { LeaderLayer, LeaderLine, anchorPoint, footprintTargets, leaderPath, updateLeader } from './LeaderLines';
export type { HudSide, LeaderLayerProps, LeaderLineProps, Point } from './LeaderLines';
export { BRANCH_ICON, BranchIcon } from './BranchIcon';
export type { BranchIconProps } from './BranchIcon';
export { KeyValue, Meter, Stat } from './Stat';
export type { KeyValueProps, MeterProps, StatProps } from './Stat';

export { StyleGuide } from './StyleGuide';
