export type ClassValue = string | false | null | undefined | 0;

/** Join class names, dropping falsy entries. */
export const cn = (...parts: ClassValue[]): string => parts.filter(Boolean).join(' ');
