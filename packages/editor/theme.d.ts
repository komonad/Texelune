import type {RGBA,ResolvedTheme,TextStyle} from './index.js';
export {themes,resolveTheme} from './index.js';
export function rgba(value: string): RGBA;
export function tokenStyle(theme: ResolvedTheme, type: string, modifiers?: string[]): TextStyle;
export function applyThemeCSS(host: HTMLElement, theme: ResolvedTheme): void;
