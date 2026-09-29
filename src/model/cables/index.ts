/**
 * Fiber cable model: connector catalog and the pure derivations (legs, kind,
 * channels, strand map, display names, legacy fields) a cable definition is
 * built from, plus the upgrade of legacy definitions, installed cable
 * instances (plugs, the links they own, compatibility, auto-fill) and their
 * schematic / floor geometry. No React / Konva / Three.
 */
export * from './connectors';
export * from './deriveSides';
export * from './strandMap';
export * from './resolve';
export * from './legacy';
export * from './instances';
export * from './geometry';
