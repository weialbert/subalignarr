import path from 'node:path';
import { PathMapping } from '../config.js';

export function hasMatchingMapping(jellyfinPath: string, mappings: PathMapping[]): boolean {
  const normalizedSource = path.posix.normalize(jellyfinPath);

  return mappings.some(
    (mapping) => normalizedSource === mapping.jellyfinPrefix || normalizedSource.startsWith(`${mapping.jellyfinPrefix}/`)
  );
}

export function resolveLocalPath(jellyfinPath: string, mappings: PathMapping[]): string {
  const normalizedSource = path.posix.normalize(jellyfinPath);

  for (const mapping of mappings) {
    if (normalizedSource === mapping.jellyfinPrefix || normalizedSource.startsWith(`${mapping.jellyfinPrefix}/`)) {
      const remainder = normalizedSource.slice(mapping.jellyfinPrefix.length).replace(/^\/+/, '');
      const resolved = path.resolve(mapping.localPrefix, remainder);
      const relative = path.relative(mapping.localPrefix, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Resolved path escaped mapping root: ${jellyfinPath}`);
      }

      return resolved;
    }
  }

  throw new Error(`No MEDIA_PATH_MAPPINGS entry matched ${jellyfinPath}`);
}
