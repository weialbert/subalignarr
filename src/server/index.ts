import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { applyOffset, getCuePreview } from './lib/alignment.js';
import { JellyfinClient } from './lib/jellyfinClient.js';
import { resolveLocalPath } from './lib/pathMapping.js';
import { SessionStore } from './lib/sessionStore.js';
import { parseSrt, serializeSrt } from './lib/srt.js';
import { loadConfig } from './config.js';

const app = express();
const config = loadConfig();
const jellyfin = new JellyfinClient(config);
const sessions = new SessionStore();

app.use(express.json());

function toError(error: unknown): { message: string } {
  return {
    message: error instanceof Error ? error.message : 'Unknown server error'
  };
}

function inferMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.ogg':
    case '.ogv':
      return 'video/ogg';
    case '.mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

async function loadSubtitleFile(resolvedPath: string): Promise<string> {
  if (config.useMockData) {
    return `1
00:00:01,000 --> 00:00:03,000
We have a mock subtitle line.

2
00:00:05,000 --> 00:00:08,000
Shift me earlier or later.
`;
  }

  return fs.readFile(resolvedPath, 'utf8');
}

function buildOutputPath(subtitlePath: string): string {
  const extension = path.extname(subtitlePath);
  const basename = subtitlePath.slice(0, -extension.length);
  const candidate = `${basename}.${config.defaultOutputSuffix}${extension || '.srt'}`;

  if (config.allowOverwrite || !existsSync(candidate)) {
    return candidate;
  }

  let attempt = 2;
  while (existsSync(`${basename}.${config.defaultOutputSuffix}.${attempt}${extension || '.srt'}`)) {
    attempt += 1;
  }

  return `${basename}.${config.defaultOutputSuffix}.${attempt}${extension || '.srt'}`;
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    mode: config.useMockData ? 'mock' : 'live',
    config: {
      baseUrlConfigured: Boolean(config.jellyfinBaseUrl),
      apiKeyConfigured: Boolean(config.jellyfinApiKey),
      userIdConfigured: Boolean(config.jellyfinUserId),
      pathMappingCount: config.pathMappings.length
    }
  });
});

app.get('/api/libraries', async (_request, response) => {
  try {
    const libraries = await jellyfin.listLibraries();
    response.json(libraries);
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

app.get('/api/items', async (request, response) => {
  try {
    const items = await jellyfin.listItems(typeof request.query.parentId === 'string' ? request.query.parentId : undefined);
    response.json(items);
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

app.get('/api/media/:itemId', async (request, response) => {
  try {
    const media = await jellyfin.getMediaDetails(request.params.itemId);
    response.json(media);
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

app.post('/api/sessions', async (request, response) => {
  try {
    const itemId = String(request.body.itemId ?? '');
    const subtitleTrackId = String(request.body.subtitleTrackId ?? '');
    if (!itemId || !subtitleTrackId) {
      response.status(400).json({ message: 'itemId and subtitleTrackId are required' });
      return;
    }

    const media = await jellyfin.getMediaDetails(itemId);
    const subtitleTrack = media.subtitleTracks.find((track) => track.id === subtitleTrackId);
    if (!subtitleTrack) {
      response.status(404).json({ message: `Subtitle track ${subtitleTrackId} not found` });
      return;
    }

    const resolvedSubtitlePath = config.useMockData ? subtitleTrack.path : resolveLocalPath(subtitleTrack.path, config.pathMappings);
    const cues = parseSrt(await loadSubtitleFile(resolvedSubtitlePath));
    const session = sessions.create(media, subtitleTrack, cues);

    response.status(201).json(sessions.toSummary(session.sessionId));
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

app.get('/api/sessions/:sessionId', (request, response) => {
  try {
    response.json(sessions.toSummary(request.params.sessionId));
  } catch (error) {
    response.status(404).json(toError(error));
  }
});

app.post('/api/sessions/:sessionId/offset', (request, response) => {
  try {
    const offsetMs = Number(request.body.offsetMs);
    if (Number.isNaN(offsetMs)) {
      response.status(400).json({ message: 'offsetMs must be a number' });
      return;
    }

    const session = sessions.updateOffset(request.params.sessionId, Math.trunc(offsetMs));
    response.json(sessions.toSummary(session.sessionId));
  } catch (error) {
    response.status(404).json(toError(error));
  }
});

app.get('/api/sessions/:sessionId/cues', (request, response) => {
  try {
    const timeMs = Number(request.query.timeMs ?? 0);
    const session = sessions.toSummary(request.params.sessionId);
    const shiftedCues = applyOffset(sessions.getOriginalCues(session.sessionId), session.offsetMs);
    response.json(getCuePreview(shiftedCues, Number.isNaN(timeMs) ? 0 : Math.trunc(timeMs)));
  } catch (error) {
    response.status(404).json(toError(error));
  }
});

app.post('/api/sessions/:sessionId/save', async (request, response) => {
  try {
    const session = sessions.toSummary(request.params.sessionId);
    const originalCues = sessions.getOriginalCues(session.sessionId);
    const shifted = applyOffset(originalCues, session.offsetMs);
    const resolvedSubtitlePath = config.useMockData
      ? path.join(process.cwd(), `${session.media.item.title}.${config.defaultOutputSuffix}.srt`)
      : resolveLocalPath(session.subtitleTrack.path, config.pathMappings);

    const outputPath = buildOutputPath(resolvedSubtitlePath);
    const outputContent = serializeSrt(shifted);
    const temporaryPath = `${outputPath}.tmp`;

    await fs.writeFile(temporaryPath, outputContent, 'utf8');
    await fs.rename(temporaryPath, outputPath);

    sessions.markSaved(session.sessionId, outputPath);
    response.json({
      ...sessions.toSummary(session.sessionId),
      savedOutputPath: outputPath
    });
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

app.get('/api/stream/:sessionId', async (request, response) => {
  try {
    const session = sessions.toSummary(request.params.sessionId);
    if (!config.useMockData) {
      const upstream = await jellyfin.requestVideoStream(session.media.item.id, session.media.mediaSourceId, request.headers.range);
      const passthroughHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];

      for (const headerName of passthroughHeaders) {
        const value = upstream.headers.get(headerName);
        if (value) {
          response.setHeader(headerName, value);
        }
      }

      response.status(upstream.status);
      if (!upstream.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstream.body).pipe(response);
      return;
    }

    const resolvedMediaPath = path.join(process.cwd(), 'public', 'mock-video.mp4');

    const stats = await fs.stat(resolvedMediaPath);
    const range = request.headers.range;
    const mimeType = inferMimeType(resolvedMediaPath);

    if (!range) {
      response.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes'
      });
      createReadStream(resolvedMediaPath).pipe(response);
      return;
    }

    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      response.status(416).end();
      return;
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : stats.size - 1;

    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mimeType
    });

    createReadStream(resolvedMediaPath, { start, end }).pipe(response);
  } catch (error) {
    response.status(500).json(toError(error));
  }
});

const webDistPath = path.resolve(process.cwd(), 'dist/web');
if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(webDistPath, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`subalignarr listening on http://localhost:${config.port}`);
});
