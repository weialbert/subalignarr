import { randomUUID } from 'node:crypto';
import { Cue, MediaDetails, SessionSummary, SubtitleTrack } from '../../shared/types.js';

interface SessionRecord {
  sessionId: string;
  media: MediaDetails;
  subtitleTrack: SubtitleTrack;
  originalCues: Cue[];
  offsetMs: number;
  dirty: boolean;
  savedOutputPath?: string;
  updatedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  create(media: MediaDetails, subtitleTrack: SubtitleTrack, originalCues: Cue[]): SessionRecord {
    const session: SessionRecord = {
      sessionId: randomUUID(),
      media,
      subtitleTrack,
      originalCues,
      offsetMs: 0,
      dirty: false,
      updatedAt: Date.now()
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): SessionRecord {
    this.pruneExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    session.updatedAt = Date.now();
    return session;
  }

  updateOffset(sessionId: string, offsetMs: number): SessionRecord {
    const session = this.get(sessionId);
    session.offsetMs = offsetMs;
    session.dirty = offsetMs !== 0;
    return session;
  }

  markSaved(sessionId: string, savedOutputPath: string): SessionRecord {
    const session = this.get(sessionId);
    session.savedOutputPath = savedOutputPath;
    session.dirty = false;
    return session;
  }

  toSummary(sessionId: string): SessionSummary {
    const session = this.get(sessionId);
    return {
      sessionId: session.sessionId,
      media: session.media,
      subtitleTrack: session.subtitleTrack,
      offsetMs: session.offsetMs,
      dirty: session.dirty,
      savedOutputPath: session.savedOutputPath
    };
  }

  getOriginalCues(sessionId: string): Cue[] {
    return this.get(sessionId).originalCues;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.ttlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
