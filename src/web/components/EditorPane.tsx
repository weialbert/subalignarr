import { useEffect, useRef, useState } from 'react';
import { CuePreview, MediaDetails, SessionSummary } from '../../shared/types';
import { api } from '../lib/api';

interface EditorPaneProps {
  media: MediaDetails | null;
  onSelectTrack: (subtitleTrackId: string) => Promise<void>;
  preferAdaptiveStream: boolean;
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

export function EditorPane({ media, onSelectTrack, preferAdaptiveStream, session, onSessionChange, selectedTrackId }: EditorPaneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cuePreview, setCuePreview] = useState<CuePreview | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !videoRef.current) {
      return;
    }

    let disposed = false;
    let hlsInstance: { destroy: () => void } | null = null;
    const video = videoRef.current;

    async function attachPreview() {
      if (!video) {
        return;
      }

      if (!preferAdaptiveStream) {
        video.src = `/api/stream/${session.sessionId}`;
        return;
      }

      const manifestUrl = `/api/stream/${session.sessionId}/master.m3u8`;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = manifestUrl;
        return;
      }

      const Hls = (await import('hls.js')).default;
      if (disposed || !Hls.isSupported()) {
        video.src = `/api/stream/${session.sessionId}`;
        return;
      }

      const hls = new Hls({
        maxBufferLength: 8,
        backBufferLength: 8
      });
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError(`Preview playback failed: ${data.details}`);
        }
      });
      hlsInstance = hls;
    }

    void attachPreview();

    return () => {
      disposed = true;
      hlsInstance?.destroy();
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [preferAdaptiveStream, session]);

  useEffect(() => {
    if (!session) {
      setCuePreview(null);
      return;
    }

    const interval = window.setInterval(async () => {
      const currentTime = videoRef.current?.currentTime ?? 0;
      try {
        const nextPreview = await api.getCuePreview(session.sessionId, currentTime * 1000);
        setCuePreview(nextPreview);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to refresh subtitles');
      }
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [session]);

  if (!session) {
    return (
      <section className="panel panel-empty">
        <p className="eyebrow">Editor</p>
        <h2>Select a video and subtitle track to begin.</h2>
      </section>
    );
  }

  async function updateOffset(offsetMs: number) {
    try {
      setError(null);
      const updated = await api.updateOffset(session.sessionId, offsetMs);
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

  return (
    <section className="panel editor-grid">
      <div className="video-column">
        <p className="eyebrow">Preview</p>
        <div className="video-frame">
          <video controls ref={videoRef} className="video-player" />
          <div className="subtitle-overlay">{cuePreview?.activeCue?.text ?? ' '}</div>
        </div>
        <div className="replay-row">
          <button
            className="ghost-button"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
              }
            }}
            type="button"
          >
            Back 5s
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.currentTime += 5;
              }
            }}
            type="button"
          >
            Forward 5s
          </button>
        </div>
      </div>

      <div className="control-column">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Track</p>
            <h2>{session.media.item.title}</h2>
          </div>
          <span className="type-pill">{session.subtitleTrack.language ?? 'unknown'}</span>
        </div>

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
            onChange={(event) => updateOffset(Number(event.target.value))}
          />
          <div className="nudge-row">
            {[-500, -100, 100, 500].map((delta) => (
              <button key={delta} className="ghost-button" onClick={() => updateOffset(session.offsetMs + delta)} type="button">
                {delta > 0 ? `+${delta}` : delta}ms
              </button>
            ))}
            <button className="ghost-button" onClick={() => updateOffset(0)} type="button">
              Reset
            </button>
          </div>
          <label htmlFor="offset-input">Offset in milliseconds</label>
          <input
            id="offset-input"
            type="number"
            value={session.offsetMs}
            onChange={(event) => updateOffset(Number(event.target.value))}
          />
        </div>

        <div className="cue-stack">
          <div>
            <p className="cue-label">Previous</p>
            <p>{cuePreview?.previousCue?.text ?? 'None'}</p>
          </div>
          <div>
            <p className="cue-label">Current</p>
            <p>{cuePreview?.activeCue?.text ?? 'None'}</p>
          </div>
          <div>
            <p className="cue-label">Next</p>
            <p>{cuePreview?.nextCue?.text ?? 'None'}</p>
          </div>
        </div>

        <div className="save-card">
          <p className="cue-label">Output</p>
          <p>{session.savedOutputPath ?? `${session.subtitleTrack.path} -> .aligned.srt`}</p>
          <button className="primary-button" disabled={isSaving} onClick={() => void saveSession()} type="button">
            {isSaving ? 'Saving...' : 'Save corrected subtitle'}
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  );
}
