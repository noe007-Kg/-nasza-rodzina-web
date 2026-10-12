import type { RRuleSet } from 'rrule';
export function googleWallDate(date: Date, zone: string): Date;
export function googleRealDate(wall: Date, zone: string): Date | null;
export function googleRecurrenceRule(date: Date, lines: readonly string[], zone: string): RRuleSet;
