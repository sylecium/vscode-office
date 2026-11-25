/**
 * What the file held in a cell, when the grid text alone cannot rebuild it. An untouched cell is
 * written back from this. It must stay JSON safe: the grid clones cells through JSON.
 */
export interface CellSource {
    /** Grid text at load time; any other text means the cell was edited. */
    text: string;
    value: unknown;
    /** `value` holds a date: epoch milliseconds for xlsx, serial number for xls and ods. */
    date?: boolean;
    /** SheetJS cell type and formula (xls, ods). */
    type?: 'b' | 'e' | 'n' | 's';
    formula?: string;
}

const DAY_MS = 86400000;
/** Serial number of 1970-01-01 in the 1900 date system. */
const EPOCH_SERIAL = 25569;

export const serialToDate = (serial: number) => new Date(Math.round((serial - EPOCH_SERIAL) * DAY_MS));
export const dateToSerial = (date: Date) => date.getTime() / DAY_MS + EPOCH_SERIAL;

/** Spreadsheet dates have no time zone: they are read and written as UTC. */
export function dateToText(date: Date): string {
    if (Number.isNaN(date.getTime())) return '';
    const [day, time] = date.toISOString().slice(0, -1).split('T');
    return time === '00:00:00.000' ? day : `${day} ${time.replace(/\.000$/, '')}`;
}

export function parseDateText(text: string): Date | undefined {
    const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?))?$/.exec(text.trim());
    if (!match) return undefined;
    const date = new Date(`${match[1]}T${match[2] ?? '00:00'}Z`);
    // Reject dates that roll over, such as February 30th.
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(match[1]) ? date : undefined;
}

/** True when typing this text would produce a number rather than a string. */
export function isNumberText(text: string): boolean {
    const trimmed = text.trim();
    return trimmed !== '' && !Number.isNaN(Number(trimmed)) && String(Number(trimmed)) === trimmed;
}
