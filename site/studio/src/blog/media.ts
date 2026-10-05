import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

// The alphabet of what upload.ts writes (a folder, "posts" or "autores", then uuids and ".webp"),
// and nothing more. This checks the shape of a path, not which folders exist: whatever is not a
// stored file is a 404 further down. An allowlist per segment is what
// makes the list of attacks short: "/", "\", "%", ":", NUL and whitespace are not in it, and a
// segment cannot start with a dot, so "..", ".", hidden files, drive letters, UNC paths and NTFS
// streams all fail here, encoded or decoded.
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SEGMENTS = 6;

const within = (root: string, target: string) => target.startsWith(root + sep);

// The bytes of a stored image, or null for anything else. Null covers "does not exist" and
// "must not be served" alike: the caller answers 404 to both and tells the client nothing.
export async function readMedia(
  uploadsDir: string,
  segments: readonly string[],
): Promise<Buffer | null> {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  for (const segment of segments) {
    if (!SEGMENT_RE.test(segment) || segment.includes("..")) return null;
  }
  // Only what upload.ts produces. The response says image/webp, so nothing else may go out.
  if (!(segments[segments.length - 1] as string).endsWith(".webp")) return null;

  const root = resolve(uploadsDir);
  const target = resolve(root, ...segments);
  // Cannot fail after the allowlist; kept because the allowlist is one regex away from a bug.
  if (!within(root, target)) return null;

  try {
    // The textual check knows nothing of links: a symlink (or a Windows junction) inside the
    // root can point anywhere. The real paths are what must nest.
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!within(realRoot, realTarget)) return null;
    if (!(await stat(realTarget)).isFile()) return null;
    return await readFile(realTarget);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Missing is the normal miss. Anything else (permissions, I/O) is worth a line in the log,
    // and is still a 404 to the client.
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.error(JSON.stringify({ at: "media", error: code ?? String(err) }));
    }
    return null;
  }
}
