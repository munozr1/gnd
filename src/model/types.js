/**
 * Core data model for Datacenter EDA.
 *
 * Mirrors KiCad's split: a LOGICAL layer (components + links, owned by the
 * schematic) and a PHYSICAL layer (placements + routes, owned by the layout).
 * Both key on `Component.id` / `Link.id`; that is how Update Layout (F8) and
 * back-annotation stay in sync across re-annotation.
 *
 * This module must stay free of React / Konva / Three imports.
 */
export {};
