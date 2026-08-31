import type { DateRange, PartialDate } from '../../types.js';

export type AnyRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pulls a string out of the several shapes LinkedIn wraps text in:
 * a bare string, `{ text: "…" }`, or `{ text: { text: "…" } }`.
 */
export function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const key of ['text', 'value', 'name', 'localized']) {
    const inner = value[key];
    const resolved = typeof inner === 'string' ? inner.trim() || null : isRecord(inner) ? text(inner) : null;
    if (resolved) return resolved;
  }
  return null;
}

/** First non-null result of reading `keys` off `source`, in order. */
export function pick(source: AnyRecord | null | undefined, ...keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ''), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function bool(value: unknown): boolean {
  return value === true;
}

/** Trailing id of a URN: `urn:li:fsd_profile:ACoAA…` -> `ACoAA…`. */
export function urnId(urn: unknown): string | null {
  if (typeof urn !== 'string') return null;
  const parts = urn.split(':');
  const last = parts[parts.length - 1];
  return last && last !== urn ? last : null;
}

export function parseDate(value: unknown): PartialDate | null {
  if (!isRecord(value)) return null;
  const year = num(value['year']);
  const month = num(value['month']);
  const day = num(value['day']);
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

const EMPTY_RANGE: DateRange = { start: null, end: null, current: false, durationMonths: null };

/**
 * Reads a `dateRange` (or a bare start/end pair) into our shape and computes a
 * duration when both ends are known.
 */
export function parseDateRange(source: AnyRecord | null | undefined, key = 'dateRange'): DateRange {
  if (!source) return { ...EMPTY_RANGE };

  const raw = isRecord(source[key]) ? (source[key] as AnyRecord) : source;
  const start = parseDate(raw['start']) ?? parseDate(source['startDate']);
  const end = parseDate(raw['end']) ?? parseDate(source['endDate']);

  // LinkedIn marks ongoing entries by omitting the end, not by a flag.
  const current = start !== null && end === null;

  return { start, end, current, durationMonths: monthsBetween(start, end) };
}

function monthsBetween(start: PartialDate | null, end: PartialDate | null): number | null {
  if (!start?.year) return null;
  const endYear = end?.year ?? new Date().getUTCFullYear();
  const endMonth = end?.month ?? (end?.year ? 12 : new Date().getUTCMonth() + 1);
  const startMonth = start.month ?? 1;

  const months = (endYear - start.year) * 12 + (endMonth - startMonth) + 1;
  return months > 0 && months < 1200 ? months : null;
}

/** LinkedIn enum -> readable text: `NATIVE_OR_BILINGUAL` -> `Native or bilingual`. */
export function humanizeEnum(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (!/^[A-Z0-9_]+$/.test(raw)) return raw;
  const [first, ...rest] = raw.toLowerCase().split('_').filter(Boolean);
  if (!first) return null;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** Company/school URN -> public LinkedIn page. */
export function companyUrlFromUrn(urn: unknown, fallbackName?: string | null): string | null {
  const id = urnId(urn);
  if (id) return `https://www.linkedin.com/company/${id}`;
  if (fallbackName) {
    const slug = fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug) return `https://www.linkedin.com/company/${slug}`;
  }
  return null;
}

/** Coerces whatever a hydrated collection field turned into to an array. */
export function asArray(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    const elements = value['elements'];
    if (Array.isArray(elements)) return elements.filter(isRecord);
    return [value];
  }
  return [];
}
