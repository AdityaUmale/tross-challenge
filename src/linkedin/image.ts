/**
 * LinkedIn never returns an image as a plain URL. It returns a VectorImage:
 * a `rootUrl` plus a list of artifacts at different widths, each contributing
 * the tail of the path. A usable URL is rootUrl + fileIdentifyingUrlPathSegment.
 *
 *   { "rootUrl": "https://media.licdn.com/dms/image/v2/D5603.../",
 *     "artifacts": [ { "width": 200, "height": 200,
 *                      "fileIdentifyingUrlPathSegment": "profile-displayphoto-shrink_200_200/0/168...?e=...&v=beta&t=..." } ] }
 */

export interface ImageSize {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ImageSet {
  /** Highest-resolution artifact, which is what most callers want. */
  largest: string | null;
  sizes: ImageSize[];
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Digs a VectorImage out of the several wrappers LinkedIn uses for it —
 * `profilePicture.displayImageReference.vectorImage`, `.displayImage`,
 * `backgroundPicture...`, or a bare vectorImage — and flattens it.
 *
 * Returns null rather than throwing: a missing profile photo is normal.
 */
export function extractImage(source: unknown): ImageSet | null {
  const vector = findVectorImage(source, 0);
  if (!vector) return null;

  const rootUrl = typeof vector['rootUrl'] === 'string' ? vector['rootUrl'] : '';
  const artifacts = Array.isArray(vector['artifacts']) ? vector['artifacts'] : [];

  const sizes: ImageSize[] = [];
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const segment = artifact['fileIdentifyingUrlPathSegment'];
    if (typeof segment !== 'string' || !segment) continue;
    // Absolute segments do appear; do not prefix those.
    const url = /^https?:\/\//i.test(segment) ? segment : `${rootUrl}${segment}`;
    sizes.push({ url, width: num(artifact['width']), height: num(artifact['height']) });
  }

  if (!sizes.length) return null;
  sizes.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return { largest: sizes[0]?.url ?? null, sizes };
}

/** Just the biggest URL, for flat fields like `profilePictureUrl`. */
export function largestImageUrl(source: unknown): string | null {
  return extractImage(source)?.largest ?? null;
}

/**
 * Depth-limited hunt for the first object carrying `artifacts`. LinkedIn keeps
 * moving the nesting around between decorations, so searching beats hardcoding
 * a path.
 */
function findVectorImage(source: unknown, depth: number): AnyRecord | null {
  if (depth > 6 || !source) return null;

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findVectorImage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(source)) return null;
  if (Array.isArray(source['artifacts'])) return source;

  for (const value of Object.values(source)) {
    const found = findVectorImage(value, depth + 1);
    if (found) return found;
  }
  return null;
}
