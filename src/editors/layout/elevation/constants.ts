/**
 * Sizes and colours for the rack elevation view. Geometry is in millimetres
 * (world units); the stage scale converts to pixels (default 1 px = 2 mm).
 */
import type { PortType } from '@/model/types';

export const DEFAULT_PX_PER_MM = 0.5;
export const MIN_PX_PER_MM = 0.04;
export const MAX_PX_PER_MM = 12;

/** Gap between adjacent rack slots (including their managers). */
export const RACK_GAP_MM = 400;
/** Width of the U rail strip drawn inside the frame on each side. */
export const RAIL_WIDTH_MM = 20;
/** Manager column x when no vertical manager is fitted (matches routing/positions). */
export const RAIL_INSET_MM = 40;
/** Side of the port squares on a faceplate. */
export const PORT_SIZE_MM = 7;
/** Cables fan out from the bundle to their ports over this length. */
export const FAN_OUT_MM = 150;
/** Velcro tie spacing along a bundle. */
export const VELCRO_PITCH_MM = 300;
/** Lateral spacing of bundles sharing a manager. */
export const BUNDLE_PITCH_MM = 12;
/** Length of the exit arrow above the roof / stub off the rack side. */
export const EXIT_MM = 220;
export const STUB_MM = 260;
/** Overhead jumper between two visible racks is drawn this far above the taller roof. */
export const JUMPER_RISE_MM = 320;
/** Pixels the pointer must move before a mousedown becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Hit tolerance for wires and ports. */
export const HIT_TOLERANCE_PX = 6;

export const COLORS = {
  bg: '#0f1115',
  panel: '#171a21',
  panel2: '#1e222b',
  border: '#2a2f3a',
  fg: '#e6e8ee',
  fgMuted: '#9aa3b5',
  accent: '#4f8cff',
  accent2: '#7cc4ff',
  error: '#ff5c5c',
  warning: '#ffb547',
  info: '#6fb3ff',
  ok: '#4ade80',
  inRack: '#ef476f',
  overhead: '#ffd166',
  rackFrame: '#3a4050',
  rackFill: '#13161c',
  rail: '#262b36',
  railText: '#6b7385',
  roof: '#1b1f27',
  plate: '#262c38',
  plateBack: '#191d25',
  plateStroke: '#3d4454',
  manager: '#1a1e26',
  managerStroke: '#333a48',
  finger: '#2c3340',
  hcm: '#20252f',
  enclosure: '#23283a',
  brush: '#4a4f5e',
  ghostOk: '#4ade80',
  ghostBad: '#ff5c5c',
  floor: '#2a2f3a',
} as const;

/** Cage colour per port type (unused ports are outlined in it). */
export const PORT_TYPE_COLORS: Record<PortType, string> = {
  SFP: '#5eead4',
  'SFP+': '#5eead4',
  SFP28: '#2dd4bf',
  'QSFP+': '#a78bfa',
  QSFP28: '#a78bfa',
  QSFP56: '#c084fc',
  'QSFP-DD': '#e879f9',
  OSFP: '#f472b6',
  RJ45: '#86efac',
  LC: '#fde68a',
  'MPO-12': '#67e8f9',
};

export const portTypeColor = (type: PortType | undefined): string => (type ? PORT_TYPE_COLORS[type] : COLORS.fgMuted);

/** HTML5 drag-and-drop media type carrying a component id from the Unplaced bin. */
export const COMPONENT_MIME = 'application/x-dc-component';
