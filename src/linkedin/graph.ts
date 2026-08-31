/**
 * Voyager's normalized response format.
 *
 * Asking for `accept: application/vnd.linkedin.normalized+json+2.1` makes
 * LinkedIn flatten its object graph instead of deeply nesting it:
 *
 *   {
 *     "data":     { "*elements": ["urn:li:fsd_profile:ACoAA..."] },
 *     "included": [ { "entityUrn": "urn:li:fsd_profile:ACoAA...",
 *                     "$type": "com.linkedin.voyager.dash.identity.profile.Profile",
 *                     "firstName": "Jane",
 *                     "*profilePositionGroups": "urn:li:fsd_profile:ACoAA.../..." } ]
 *   }
 *
 * Every entity is addressable by `entityUrn`, and any field whose name starts
 * with `*` is a pointer into `included` rather than a value. This class indexes
 * that graph and walks the pointers, so parsers can work with plain objects and
 * never think about URNs.
 */

export type AnyRecord = Record<string, unknown>;

export interface NormalizedPayload {
  data?: unknown;
  included?: unknown[];
}

const DEFAULT_MAX_DEPTH = 12;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class EntityGraph {
  private readonly byUrn = new Map<string, AnyRecord>();
  private readonly byType = new Map<string, AnyRecord[]>();
  private readonly rootData: unknown;

  constructor(payload: NormalizedPayload | undefined | null) {
    this.rootData = payload?.data;

    for (const raw of payload?.included ?? []) {
      if (!isRecord(raw)) continue;

      const urn = typeof raw['entityUrn'] === 'string' ? raw['entityUrn'] : undefined;
      if (urn) {
        // LinkedIn sometimes emits the same URN twice, each copy carrying a
        // different subset of fields. Merge rather than letting one win.
        const existing = this.byUrn.get(urn);
        this.byUrn.set(urn, existing ? { ...existing, ...raw } : raw);
      }

      const type = typeof raw['$type'] === 'string' ? raw['$type'] : undefined;
      if (type) {
        const bucket = this.byType.get(type);
        if (bucket) bucket.push(raw);
        else this.byType.set(type, [raw]);
      }
    }
  }

  get size(): number {
    return this.byUrn.size;
  }

  /** Raw entity for a URN, with pointers left unresolved. */
  get(urn: string): AnyRecord | undefined {
    return this.byUrn.get(urn);
  }

  /** All entities of an exact `$type`. */
  ofType(type: string): AnyRecord[] {
    return this.byType.get(type) ?? [];
  }

  /**
   * All entities whose `$type` ends with `suffix`, e.g. `.Profile` or
   * `.ProfilePosition`. Matching on the tail keeps us working when LinkedIn
   * moves a class between packages, which it does.
   */
  ofTypeSuffix(suffix: string): AnyRecord[] {
    const out: AnyRecord[] = [];
    for (const [type, entities] of this.byType) {
      if (type.endsWith(suffix)) out.push(...entities);
    }
    return out;
  }

  /** Every distinct `$type` present — useful when a capture drifts and you need to see what arrived. */
  types(): string[] {
    return [...this.byType.keys()].sort();
  }

  /**
   * The entities the response body actually points at, following `*elements`
   * on a CollectionResponse or a bare `*element` on a single-entity response.
   */
  rootElements(): AnyRecord[] {
    const data = isRecord(this.rootData) && isRecord(this.rootData['data'])
      ? (this.rootData['data'] as AnyRecord)
      : this.rootData;
    if (!isRecord(data)) return [];

    const urns: string[] = [];
    for (const key of ['*elements', 'elements', '*element', '*profile']) {
      const value = data[key];
      if (typeof value === 'string') urns.push(value);
      else if (Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string') urns.push(v);
      }
    }

    const seen = new Set<string>();
    const out: AnyRecord[] = [];
    for (const urn of urns) {
      if (seen.has(urn)) continue;
      seen.add(urn);
      const entity = this.byUrn.get(urn);
      if (entity) out.push(entity);
    }
    return out;
  }

  /**
   * Deep-resolves an entity: `*`-prefixed pointers are replaced by the entities
   * they name (with the `*` stripped from the key), collections collapse to
   * arrays, and everything else is copied through.
   *
   * Cycles are real here — a position points at a company which points back at
   * people — so the current path is tracked and revisits are dropped.
   */
  hydrate<T = AnyRecord>(value: unknown, maxDepth = DEFAULT_MAX_DEPTH): T {
    return this.walk(value, maxDepth, new Set<string>()) as T;
  }

  /** Convenience: resolve a URN straight to a hydrated object. */
  hydrateUrn(urn: string, maxDepth = DEFAULT_MAX_DEPTH): AnyRecord | undefined {
    const entity = this.byUrn.get(urn);
    return entity ? this.hydrate<AnyRecord>(entity, maxDepth) : undefined;
  }

  private walk(value: unknown, depth: number, path: Set<string>): unknown {
    if (depth <= 0 || value === null || value === undefined) return value ?? null;
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth - 1, path));
    // Scalars pass through untouched. Only `*`-prefixed keys are pointers, so a
    // plain string is a value even when it happens to look like a URN —
    // `entityUrn` is the obvious case, and resolving it would replace an id
    // with the entity it names.
    if (!isRecord(value)) return value;

    const out: AnyRecord = {};
    for (const [key, raw] of Object.entries(value)) {
      if (key === '$recipeTypes' || key === '$anti_abuse_metadata') continue;
      // Keys come from an upstream document we do not control, and assigning
      // `out['__proto__']` by bracket notation invokes the prototype setter.
      if (UNSAFE_KEYS.has(key) || UNSAFE_KEYS.has(key.slice(1))) continue;

      if (key.startsWith('*')) {
        // A pointer to a paged collection is more useful as a plain array.
        out[key.slice(1)] = unwrapCollection(this.follow(raw, depth - 1, path));
      } else {
        out[key] = this.walk(raw, depth - 1, path);
      }
    }
    return out;
  }

  /** Resolves the value of a `*` key: a URN, a list of URNs, or an inline object. */
  private follow(raw: unknown, depth: number, path: Set<string>): unknown {
    if (depth <= 0) return raw ?? null;
    if (Array.isArray(raw)) return raw.map((item) => this.follow(item, depth - 1, path));

    if (typeof raw === 'string') {
      // Revisiting a URN already on this branch means a cycle; keep the URN.
      if (path.has(raw)) return raw;
      const target = this.byUrn.get(raw);
      // A dangling pointer is normal when LinkedIn trims the payload.
      if (!target) return raw;
      return this.walk(target, depth, new Set(path).add(raw));
    }
    return this.walk(raw, depth, path);
  }
}

/**
 * Paged collections arrive as `{ elements: [...], paging: {...} }`. Parsers only
 * ever want the elements, so collapse the wrapper.
 */
function unwrapCollection(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const elements = value['elements'];
  if (Array.isArray(elements)) return elements;
  return value;
}
