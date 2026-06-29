/**
 * Silent-Luxury editorial primitives — the shared building blocks every hub tab
 * composes from. Presentation-only; all colour comes from the `.lux-theme`
 * token scope in globals.css.
 */

export { default as LuxShell } from "./LuxShell";
export type { LuxShellProps } from "./LuxShell";

export { default as LuxTitle, LuxAccent } from "./LuxTitle";
export type { LuxTitleProps } from "./LuxTitle";

export { default as LuxCTA } from "./LuxCTA";
export type { LuxCTAProps } from "./LuxCTA";

export { default as Section } from "./Section";
export type { SectionProps } from "./Section";

export { default as LuxStat } from "./LuxStat";
export type { LuxStatProps } from "./LuxStat";
