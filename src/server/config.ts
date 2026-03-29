import path from 'node:path';

export interface PathMapping {
  jellyfinPrefix: string;
  localPrefix: string;
}

export interface AppConfig {
  port: number;
  jellyfinBaseUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId: string;
  pathMappings: PathMapping[];
  defaultOutputSuffix: string;
  allowOverwrite: boolean;
  useMockData: boolean;
}

function normalizePrefix(value: string): string {
  const normalized = value.replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : '/';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function parseMappings(value: string | undefined): PathMapping[] {
  if (!value) {
    return [];
  }

  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [jellyfinPrefix, localPrefix] = entry.split('=');
      if (!jellyfinPrefix || !localPrefix) {
        throw new Error(`Invalid MEDIA_PATH_MAPPINGS entry: ${entry}`);
      }

      return {
        jellyfinPrefix: normalizePrefix(path.posix.normalize(jellyfinPrefix)),
        localPrefix: normalizePrefix(path.resolve(localPrefix))
      };
    });
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.APP_PORT ?? 3001),
    jellyfinBaseUrl: (process.env.JELLYFIN_BASE_URL ?? '').replace(/\/+$/, ''),
    jellyfinApiKey: process.env.JELLYFIN_API_KEY ?? '',
    jellyfinUserId: process.env.JELLYFIN_USER_ID ?? '',
    pathMappings: parseMappings(process.env.MEDIA_PATH_MAPPINGS),
    defaultOutputSuffix: process.env.DEFAULT_OUTPUT_SUFFIX ?? 'aligned',
    allowOverwrite: parseBoolean(process.env.ALLOW_OVERWRITE, false),
    useMockData: parseBoolean(process.env.USE_MOCK_DATA, false)
  };
}
