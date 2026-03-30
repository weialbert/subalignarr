import { useEffect, useRef, useState } from 'react';
import { Cue, CuePreview, MediaDetails, PreviewStatusResponse, SessionSummary } from '../../shared/types';
import { api } from '../lib/api';

interface EditorPaneProps {
  media: MediaDetails | null;
  onSelectTrack: (subtitleTrackId: string) => Promise<void>;
  session: SessionSummary | null;
  onSessionChange: (session: SessionSummary) => void;
  selectedTrackId: string | null;
}

const SLIDER_MIN = -10000;
const SLIDER_MAX = 10000;

function msLabel(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value} ms`;
}

function subtitleLabel(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getCueContext(cues: Cue[], timeMs: number): CuePreview {
  let previousCue: Cue | null = null;
  let activeCue: Cue | null = null;
  let nextCue: Cue | null = null;

  for (const cue of cues) {
    if (cue.endMs < timeMs) {
      previousCue = cue;
      continue;
    }

    if (cue.startMs <= timeMs && cue.endMs >= timeMs) {
      activeCue = cue;
      continue;
    }

    if (cue.startMs > timeMs) {
      nextCue = cue;
      break;
    }
  }

  return { previousCue, activeCue, nextCue };
}

export function EditorPane({ media, onSelectTrack, session, onSessionChange, selectedTrackId }: EditorPaneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatusResponse | null>(null);
  const [cueSearch, setCueSearch] = useState('');
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [bookmarkedCueIndexes, setBookmarkedCueIndexes] = useState<number[]>([]);
  const [selectedCueIndex, setSelectedCueIndex] = useState<number | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeVideoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setCueSearch('');
    setShowBookmarksOnly(false);
    setBookmarkedCueIndexes([]);
    setSelectedCueIndex(null);
    setCurrentTimeMs(0);
    setError(null);
    setPreviewStatus(null);

    if (!session) {
      setCues([]);
      return;
    }

    let cancelled = false;
    void api
      .getSessionCues(session.sessionId)
      .then((nextCues) => {
        if (cancelled) {
          return;
        }

        setCues(nextCues);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load subtitle cues');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function refreshPreviewStatus() {
      try {
        const nextStatus = await api.getPreviewStatus(session.sessionId);
        if (cancelled) {
          return;
        }

        setPreviewStatus(nextStatus);
        if (nextStatus.status !== 'preparing' && timer !== null) {
          window.clearInterval(timer);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to prepare preview video');
        }
      }
    }

    void refreshPreviewStatus();
    timer = window.setInterval(() => {
      void refreshPreviewStatus();
    }, 1500);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const updateCurrentTime = () => {
      setCurrentTimeMs(Math.floor(video.currentTime * 1000));
    };

    video.addEventListener('timeupdate', updateCurrentTime);
    video.addEventListener('seeking', updateCurrentTime);
    video.addEventListener('loadedmetadata', updateCurrentTime);

    return () => {
      video.removeEventListener('timeupdate', updateCurrentTime);
      video.removeEventListener('seeking', updateCurrentTime);
      video.removeEventListener('loadedmetadata', updateCurrentTime);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session) {
      return;
    }

    const fallbackUrl = `/api/stream/${session.sessionId}`;
    const nextUrl =
      previewStatus?.status === 'ready' && previewStatus.streamUrl
        ? previewStatus.streamUrl
        : fallbackUrl;

    if (activeVideoUrlRef.current === nextUrl) {
      return;
    }

    const previousTime = video.currentTime;
    activeVideoUrlRef.current = nextUrl;
    video.src = nextUrl;
    video.load();

    const restoreTime = () => {
      if (previousTime > 0) {
        video.currentTime = previousTime;
      }
      video.removeEventListener('loadedmetadata', restoreTime);
    };

    video.addEventListener('loadedmetadata', restoreTime);

    return () => {
      video.removeEventListener('loadedmetadata', restoreTime);
    };
  }, [previewStatus, session]);

  if (!session) {
    return (
      <section className="panel panel-empty">
        <p className="eyebrow">Editor</p>
        <h2>Select a video and subtitle track to begin.</h2>
      </section>
    );
  }

  const bookmarkSet = new Set(bookmarkedCueIndexes);
  const searchTerm = cueSearch.trim().toLowerCase();
  const selectedCue = cues.find((cue) => cue.index === selectedCueIndex) ?? null;
  const cueContext = getCueContext(cues, currentTimeMs - session.offsetMs);
  const filteredCues = cues.filter((cue) => {
    if (showBookmarksOnly && !bookmarkSet.has(cue.index)) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    return cue.text.toLowerCase().includes(searchTerm);
  });
  const proposedOffsetMs = selectedCue ? currentTimeMs - selectedCue.startMs : null;

  async function updateOffset(offsetMs: number) {
    try {
      setError(null);
      const updated = await api.updateOffset(session.sessionId, Math.trunc(offsetMs));
      onSessionChange(updated);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update offset');
    }
  }

  async function saveSession() {
    try {
      setIsSaving(true);
      setError(null);
      const updated = await api.saveSession(session.sessionId);
      onSessionChange(updated);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save subtitle file');
    } finally {
      setIsSaving(false);
    }
  }

  function jumpVideoToMs(timeMs: number) {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.currentTime = Math.max(0, timeMs / 1000);
  }

  function jumpToCue(cue: Cue) {
    jumpVideoToMs(cue.startMs + session.offsetMs);
  }

  function replayAroundCue(cue: Cue) {
    const startTimeMs = Math.max(0, cue.startMs + session.offsetMs - 1500);
    jumpVideoToMs(startTimeMs);
    void videoRef.current?.play().catch(() => undefined);
  }

  function toggleBookmark(cueIndex: number) {
    setBookmarkedCueIndexes((currentBookmarks) =>
      currentBookmarks.includes(cueIndex)
        ? currentBookmarks.filter((entry) => entry !== cueIndex)
        : [...currentBookmarks, cueIndex]
    );
  }

  return (
    <section className="panel editor-shell">
      <div className="editor-main">
        <div className="video-column">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>{session.media.item.title}</h2>
            </div>
            <span className="type-pill">{session.subtitleTrack.language ?? 'unknown'}</span>
          </div>

          <div className="video-frame">
            {previewStatus?.status === 'preparing' ? <div className="preview-loading">Preparing low-res preview…</div> : null}
            <video controls ref={videoRef} className="video-player" />
            <div className="subtitle-overlay">{cueContext.activeCue?.text ?? ' '}</div>
          </div>

          <div className="preview-meta">
            <span>Playhead {formatTimestamp(currentTimeMs)}</span>
            <span>Applied offset {msLabel(session.offsetMs)}</span>
            {proposedOffsetMs !== null ? <span>Proposed offset {msLabel(proposedOffsetMs)}</span> : null}
          </div>

          <div className="replay-row">
            <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs - 5000)} type="button">
              Back 5s
            </button>
            <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs - 2000)} type="button">
              Back 2s
            </button>
            <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs + 2000)} type="button">
              Forward 2s
            </button>
            <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs + 5000)} type="button">
              Forward 5s
            </button>
          </div>

          {selectedCue ? (
            <div className="anchor-card">
              <p className="eyebrow">Anchor</p>
              <p className="anchor-title">{selectedCue.text}</p>
              <p>
                Cue timestamp {formatTimestamp(selectedCue.startMs)}. Use the current playhead as the matching moment, then apply the
                derived global offset.
              </p>
              <div className="replay-row">
                <button className="ghost-button" onClick={() => jumpToCue(selectedCue)} type="button">
                  Jump To Cue
                </button>
                <button className="ghost-button" onClick={() => replayAroundCue(selectedCue)} type="button">
                  Replay Around Cue
                </button>
                <button className="primary-button" onClick={() => void updateOffset(proposedOffsetMs ?? session.offsetMs)} type="button">
                  Align Here
                </button>
              </div>
            </div>
          ) : null}

          <div className="cue-stack">
            <div>
              <p className="cue-label">Previous</p>
              <p>{cueContext.previousCue?.text ?? 'None'}</p>
            </div>
            <div>
              <p className="cue-label">Current</p>
              <p>{cueContext.activeCue?.text ?? 'None'}</p>
            </div>
            <div>
              <p className="cue-label">Next</p>
              <p>{cueContext.nextCue?.text ?? 'None'}</p>
            </div>
          </div>
        </div>

        <div className="control-column">
          {media ? (
            <div className="offset-card">
              <label htmlFor="subtitle-track-select">Subtitle selected for editing</label>
              <select
                id="subtitle-track-select"
                value={selectedTrackId ?? ''}
                onChange={(event) => void onSelectTrack(event.target.value)}
              >
                {media.subtitleTracks.map((track) => (
                  <option key={track.id} value={track.id} disabled={!track.isEditable}>
                    {`${track.language ?? 'unknown'} • ${track.format} • ${subtitleLabel(track.path)}`}
                  </option>
                ))}
              </select>
              <p>{session.subtitleTrack.path}</p>
              {media.subtitleTracks.some((track) => !track.isEditable) ? (
                <p className="error-text">
                  Only subtitle files physically stored alongside mapped media files are supported. Metadata-managed subtitle paths are
                  shown but cannot be edited.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="offset-card">
            <label htmlFor="offset-slider">Global offset</label>
            <div className="offset-readout">{msLabel(session.offsetMs)}</div>
            <input
              id="offset-slider"
              type="range"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={50}
              value={Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, session.offsetMs))}
              onChange={(event) => void updateOffset(Number(event.target.value))}
            />
            <div className="nudge-row">
              {[-500, -100, 100, 500].map((delta) => (
                <button key={delta} className="ghost-button" onClick={() => void updateOffset(session.offsetMs + delta)} type="button">
                  {delta > 0 ? `+${delta}` : delta}ms
                </button>
              ))}
              <button className="ghost-button" onClick={() => void updateOffset(0)} type="button">
                Reset
              </button>
            </div>
          </div>

          <div className="offset-card">
            <div className="panel-header compact-header">
              <div>
                <p className="eyebrow">Subtitle Navigator</p>
                <h3>{filteredCues.length} cues</h3>
              </div>
              <button className="ghost-button" onClick={() => setShowBookmarksOnly((current) => !current)} type="button">
                {showBookmarksOnly ? 'Show All' : 'Bookmarks'}
              </button>
            </div>
            <input
              type="search"
              placeholder="Search subtitle text"
              value={cueSearch}
              onChange={(event) => setCueSearch(event.target.value)}
            />
            <div className="cue-list">
              {filteredCues.map((cue) => {
                const isSelected = cue.index === selectedCueIndex;
                const isActive = cue.index === cueContext.activeCue?.index;
                const isBookmarked = bookmarkSet.has(cue.index);

                return (
                  <div
                    key={cue.index}
                    className={`cue-list-item${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                  >
                    <button className="cue-list-button" onClick={() => setSelectedCueIndex(cue.index)} type="button">
                      <span className="cue-timestamp">{formatTimestamp(cue.startMs)}</span>
                      <span>{cue.text}</span>
                    </button>
                    <div className="cue-actions">
                      <button className="ghost-button" onClick={() => jumpToCue(cue)} type="button">
                        Jump
                      </button>
                      <button className="ghost-button" onClick={() => toggleBookmark(cue.index)} type="button">
                        {isBookmarked ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredCues.length === 0 ? <p>No cues match the current filter.</p> : null}
            </div>
          </div>

          <div className="save-card">
            <p className="cue-label">Output</p>
            <p>{session.savedOutputPath ?? `${session.subtitleTrack.path} -> .aligned.srt`}</p>
            <button className="primary-button" disabled={isSaving} onClick={() => void saveSession()} type="button">
              {isSaving ? 'Saving...' : 'Save corrected subtitle'}
            </button>
          </div>

          {previewStatus?.status === 'error' ? <p className="error-text">{previewStatus.errorMessage ?? 'Preview generation failed'}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
