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

type EditorStep = 'choose' | 'inspect' | 'align' | 'verify';

interface StepDefinition {
  id: EditorStep;
  label: string;
}

const SLIDER_MIN = -10000;
const SLIDER_MAX = 10000;
const STEP_DEFINITIONS: StepDefinition[] = [
  { id: 'choose', label: 'Choose Cue' },
  { id: 'inspect', label: 'Inspect Cue' },
  { id: 'align', label: 'Align' },
  { id: 'verify', label: 'Verify & Save' }
];

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

function uniqueCues(cues: Cue[]): Cue[] {
  const seen = new Set<number>();
  return cues.filter((cue) => {
    if (seen.has(cue.index)) {
      return false;
    }

    seen.add(cue.index);
    return true;
  });
}

export function EditorPane({ media, onSelectTrack, session, onSessionChange, selectedTrackId }: EditorPaneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activePreviewWindowRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const preferredTimeMsRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatusResponse | null>(null);
  const [cueSearch, setCueSearch] = useState('');
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [bookmarkedCueIndexes, setBookmarkedCueIndexes] = useState<number[]>([]);
  const [selectedCueIndex, setSelectedCueIndex] = useState<number | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [requestedPreviewTimeMs, setRequestedPreviewTimeMs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<EditorStep>('choose');
  const activeVideoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      activeSessionIdRef.current = null;
      setCueSearch('');
      setShowBookmarksOnly(false);
      setBookmarkedCueIndexes([]);
      setSelectedCueIndex(null);
      setCurrentTimeMs(0);
      setRequestedPreviewTimeMs(0);
      setError(null);
      setPreviewStatus(null);
      setVideoStatus('idle');
      setVideoError(null);
      setCurrentStep('choose');
      preferredTimeMsRef.current = null;
      activePreviewWindowRef.current = null;
      setCues([]);
      return;
    }

    const isNewSession = activeSessionIdRef.current !== session.sessionId;
    activeSessionIdRef.current = session.sessionId;

    if (!isNewSession) {
      return;
    }

    setCueSearch('');
    setShowBookmarksOnly(false);
    setBookmarkedCueIndexes([]);
    setSelectedCueIndex(null);
    setCurrentTimeMs(0);
    setRequestedPreviewTimeMs(0);
    setIsPlaying(false);
    setError(null);
    setPreviewStatus(null);
    setVideoStatus('idle');
    setVideoError(null);
    setCurrentStep('choose');
    preferredTimeMsRef.current = null;
    activePreviewWindowRef.current = null;

    let cancelled = false;
    void api
      .getSessionCues(session.sessionId)
      .then((nextCues) => {
        if (!cancelled) {
          setCues(nextCues);
        }
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
    const previewTargetMs = Math.max(0, requestedPreviewTimeMs);

    async function refreshPreviewStatus() {
      try {
        const nextStatus = await api.getPreviewStatus(session.sessionId, previewTargetMs);
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
  }, [requestedPreviewTimeMs, session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const updateCurrentTime = () => {
      const activePreviewWindow = activePreviewWindowRef.current;
      const absoluteTimeMs = activePreviewWindow
        ? activePreviewWindow.startMs + Math.floor(video.currentTime * 1000)
        : Math.floor(video.currentTime * 1000);
      setCurrentTimeMs(absoluteTimeMs);
      preferredTimeMsRef.current = absoluteTimeMs;
      setRequestedPreviewTimeMs(absoluteTimeMs);
    };

    const handleLoadStart = () => {
      setVideoStatus('loading');
      setVideoError(null);
    };

    const handleLoadedData = () => {
      setVideoStatus('ready');
      setVideoError(null);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      const mediaError = video.error;
      const message =
        mediaError?.message ||
        (mediaError?.code === 4
          ? 'Browser could not decode this video source.'
          : mediaError?.code === 3
            ? 'Video decode failed.'
            : mediaError?.code === 2
              ? 'Network error while loading video.'
              : 'Unknown video playback error.');
      setVideoStatus('error');
      setVideoError(message);
      console.error('[video] error', {
        code: mediaError?.code,
        message,
        currentSrc: video.currentSrc,
        networkState: video.networkState,
        readyState: video.readyState
      });
    };

    video.addEventListener('timeupdate', updateCurrentTime);
    video.addEventListener('seeking', updateCurrentTime);
    video.addEventListener('loadedmetadata', updateCurrentTime);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', updateCurrentTime);
      video.removeEventListener('seeking', updateCurrentTime);
      video.removeEventListener('loadedmetadata', updateCurrentTime);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session) {
      return;
    }

    const fallbackUrl = `/api/stream/${session.sessionId}`;
    const desiredAbsoluteTimeMs = preferredTimeMsRef.current ?? currentTimeMs;
    const previewWindow =
      previewStatus?.windowStartMs !== undefined && previewStatus?.windowEndMs !== undefined
        ? {
            startMs: previewStatus.windowStartMs,
            endMs: previewStatus.windowEndMs
          }
        : null;
    const canUsePreview =
      Boolean(previewStatus?.streamUrl) &&
      Boolean(previewWindow) &&
      desiredAbsoluteTimeMs >= (previewWindow?.startMs ?? 0) &&
      desiredAbsoluteTimeMs <= (previewWindow?.endMs ?? 0);
    const nextUrl = canUsePreview && previewStatus?.streamUrl ? previewStatus.streamUrl : previewStatus?.directSourcePlayable ? fallbackUrl : null;

    if (activeVideoUrlRef.current === nextUrl) {
      activePreviewWindowRef.current = canUsePreview && previewWindow ? previewWindow : null;
      return;
    }

    const previousAbsoluteTimeMs =
      preferredTimeMsRef.current ??
      (activePreviewWindowRef.current
        ? activePreviewWindowRef.current.startMs + Math.floor(video.currentTime * 1000)
        : Math.floor(video.currentTime * 1000));

    activeVideoUrlRef.current = nextUrl;
    activePreviewWindowRef.current = canUsePreview && previewWindow ? previewWindow : null;
    if (!nextUrl) {
      video.removeAttribute('src');
      video.load();
      setVideoStatus('loading');
      setVideoError(null);
      preferredTimeMsRef.current = previousAbsoluteTimeMs;
      return;
    }
    video.src = nextUrl;
    video.preload = 'auto';
    video.load();

    const restoreTime = () => {
      const activePreviewWindow = activePreviewWindowRef.current;
      if (activePreviewWindow) {
        video.currentTime = Math.max(0, (previousAbsoluteTimeMs - activePreviewWindow.startMs) / 1000);
      } else if (previousAbsoluteTimeMs > 0) {
        video.currentTime = previousAbsoluteTimeMs / 1000;
      }

      preferredTimeMsRef.current = previousAbsoluteTimeMs;

      video.removeEventListener('loadedmetadata', restoreTime);
    };

    video.addEventListener('loadedmetadata', restoreTime);

    return () => {
      video.removeEventListener('loadedmetadata', restoreTime);
    };
  }, [currentTimeMs, previewStatus, session]);

  if (!session) {
    return (
      <section className="panel panel-empty editor-empty-state">
        <p className="eyebrow">Workflow</p>
        <h2>Open a video with a sidecar subtitle to begin alignment.</h2>
        <p>Search for a cue, inspect the moment, align it to the playhead, then verify and save.</p>
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
  const bookmarkedCues = cues.filter((cue) => bookmarkSet.has(cue.index));
  const candidateCues = uniqueCues([
    ...(selectedCue ? [selectedCue] : []),
    ...bookmarkedCues,
    ...filteredCues.slice(0, searchTerm ? 8 : 6)
  ]).slice(0, 8);
  const proposedOffsetMs = selectedCue ? currentTimeMs - selectedCue.startMs : null;
  const mediaDurationMs = session.media.item.durationMs ?? Math.max(currentTimeMs, requestedPreviewTimeMs, 1);
  const activePreviewWindow = activePreviewWindowRef.current;
  const previewRangeLabel =
    previewStatus?.windowStartMs !== undefined && previewStatus?.windowEndMs !== undefined
      ? `${formatTimestamp(previewStatus.windowStartMs)}-${formatTimestamp(previewStatus.windowEndMs)}`
      : null;
  const previewModeLabel =
    activePreviewWindow && previewStatus?.status === 'ready'
        ? 'Quick preview'
        : previewStatus?.directSourcePlayable
          ? 'Direct source'
          : 'Waiting for preview';
  const previewHint =
    previewStatus?.status === 'preparing'
        ? `${
            previewStatus?.directSourcePlayable === false ? 'Playable preview' : 'Quick preview'
          } is preparing for ${previewRangeLabel ?? 'the nearby area'}.`
      : activePreviewWindow && previewStatus?.status === 'ready'
        ? `Quick preview is active for ${previewRangeLabel}.`
        : previewStatus?.directSourcePlayable === false
          ? 'Source video is not browser-playable. Waiting for a compatible local preview.'
          : 'Preview fallback is active.';
  const showPreviewWaitOverlay = !activePreviewWindow && previewStatus?.directSourcePlayable === false;
  const showVideoErrorOverlay = videoStatus === 'error';
  const canTogglePlayback = videoStatus === 'ready';
  const stepStatus = {
    choose: true,
    inspect: Boolean(selectedCue),
    align: Boolean(selectedCue),
    verify: session.offsetMs !== 0 || Boolean(session.savedOutputPath)
  };

  async function updateOffset(offsetMs: number, nextStep?: EditorStep) {
    try {
      setError(null);
      const updated = await api.updateOffset(session.sessionId, Math.trunc(offsetMs));
      onSessionChange(updated);
      if (nextStep) {
        setCurrentStep(nextStep);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update offset');
    }
  }

  async function applyAnchorAlignment() {
    if (proposedOffsetMs === null) {
      return;
    }

    await updateOffset(proposedOffsetMs, 'verify');
  }

  async function saveSession() {
    try {
      setIsSaving(true);
      setError(null);
      const updated = await api.saveSession(session.sessionId);
      onSessionChange(updated);
      setCurrentStep('verify');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save subtitle file');
    } finally {
      setIsSaving(false);
    }
  }

  function jumpVideoToMs(timeMs: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextAbsoluteTimeMs = Math.max(0, timeMs);
    preferredTimeMsRef.current = nextAbsoluteTimeMs;
    setCurrentTimeMs(nextAbsoluteTimeMs);
    setRequestedPreviewTimeMs(nextAbsoluteTimeMs);

    if (activePreviewWindow && nextAbsoluteTimeMs >= activePreviewWindow.startMs && nextAbsoluteTimeMs <= activePreviewWindow.endMs) {
      video.currentTime = Math.max(0, (nextAbsoluteTimeMs - activePreviewWindow.startMs) / 1000);
      return;
    }

    activePreviewWindowRef.current = null;
    activeVideoUrlRef.current = null;
    if (previewStatus?.directSourcePlayable === false) {
      video.removeAttribute('src');
      video.load();
      return;
    }
    video.src = `/api/stream/${session.sessionId}`;
    video.load();
    const restoreTime = () => {
      video.currentTime = nextAbsoluteTimeMs / 1000;
      video.removeEventListener('loadedmetadata', restoreTime);
    };
    video.addEventListener('loadedmetadata', restoreTime);
  }

  function jumpToCue(cue: Cue) {
    jumpVideoToMs(cue.startMs + session.offsetMs);
  }

  function replayAroundCue(cue: Cue) {
    const startTimeMs = Math.max(0, cue.startMs + session.offsetMs - 1500);
    jumpVideoToMs(startTimeMs);
    void videoRef.current?.play().catch(() => undefined);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !canTogglePlayback) {
      return;
    }

    if (video.paused) {
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
  }

  function scrubToMs(nextTimeMs: number) {
    jumpVideoToMs(nextTimeMs);
  }

  function toggleBookmark(cueIndex: number) {
    setBookmarkedCueIndexes((currentBookmarks) =>
      currentBookmarks.includes(cueIndex)
        ? currentBookmarks.filter((entry) => entry !== cueIndex)
        : [...currentBookmarks, cueIndex]
    );
  }

  function selectCue(cue: Cue) {
    setSelectedCueIndex(cue.index);
    setCurrentStep('inspect');
  }

  function returnToChooseStep() {
    setCurrentStep('choose');
  }

  function moveToStep(step: EditorStep) {
    if (step === 'choose') {
      setCurrentStep('choose');
      return;
    }

    if (!selectedCue) {
      return;
    }

    if (step === 'verify' && !stepStatus.verify) {
      return;
    }

    setCurrentStep(step);
  }

  return (
    <section className="panel editor-shell">
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Alignment Workflow</p>
          <h2>{session.media.item.title}</h2>
          <p className="editor-subtitle">
            Select one anchor cue, match it to the picture or audio, then verify the resulting global offset.
          </p>
        </div>
        <div className="session-summary">
          <span className="type-pill">{session.subtitleTrack.language ?? 'unknown'}</span>
          <span className={`session-flag${session.dirty ? ' is-dirty' : ''}`}>
            {session.savedOutputPath ? 'Saved' : session.dirty ? 'Unsaved changes' : 'Ready'}
          </span>
        </div>
      </div>

      <div className="stepper-row" aria-label="Alignment steps">
        {STEP_DEFINITIONS.map((step, index) => {
          const isActive = currentStep === step.id;
          const isComplete =
            (step.id === 'choose' && stepStatus.inspect) ||
            (step.id === 'inspect' && (currentStep === 'align' || currentStep === 'verify')) ||
            (step.id === 'align' && stepStatus.verify) ||
            (step.id === 'verify' && Boolean(session.savedOutputPath));
          const isEnabled =
            step.id === 'choose' ||
            (step.id !== 'verify' && stepStatus.inspect) ||
            (step.id === 'verify' && stepStatus.verify);

          return (
            <button
              key={step.id}
              className={`step-pill${isActive ? ' is-active' : ''}${isComplete ? ' is-complete' : ''}`}
              disabled={!isEnabled}
              onClick={() => moveToStep(step.id)}
              type="button"
            >
              <span className="step-index">{index + 1}</span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>

      <div className="editor-main">
        <div className="active-column">
          <div className="video-frame">
            <div className="video-status-chip">{previewModeLabel}</div>
            {showPreviewWaitOverlay ? <div className="preview-loading">{previewHint}</div> : null}
            {showVideoErrorOverlay ? <div className="preview-loading">{videoError ?? 'Video playback failed.'}</div> : null}
            <video playsInline ref={videoRef} className="video-player" />
            <div className="subtitle-overlay">{cueContext.activeCue?.text ?? ' '}</div>
          </div>

          <div className="timeline-card">
            <div className="timeline-header">
              <button className="primary-button timeline-play" disabled={!canTogglePlayback} onClick={togglePlayback} type="button">
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <div className="timeline-readout">
                <span>{formatTimestamp(currentTimeMs)}</span>
                <span>{formatTimestamp(mediaDurationMs)}</span>
              </div>
            </div>
            <input
              aria-label="Full media timeline"
              className="timeline-slider"
              max={mediaDurationMs}
              min={0}
              onChange={(event) => scrubToMs(Number(event.target.value))}
              onInput={(event) => scrubToMs(Number((event.target as HTMLInputElement).value))}
              step={250}
              type="range"
              value={Math.max(0, Math.min(mediaDurationMs, currentTimeMs))}
            />
          </div>

          <div className="player-status-bar">
            <span>Playhead {formatTimestamp(currentTimeMs)}</span>
            <span>Offset {msLabel(session.offsetMs)}</span>
            {selectedCue ? <span>Anchor {formatTimestamp(selectedCue.startMs)}</span> : <span>No anchor selected</span>}
            {proposedOffsetMs !== null ? <span>Proposed {msLabel(proposedOffsetMs)}</span> : null}
          </div>

          <div className="active-step-card">
            {currentStep === 'choose' ? (
              <>
                <div className="active-step-header">
                  <div>
                    <p className="eyebrow">Step 1</p>
                    <h3>Choose a likely sync landmark</h3>
                  </div>
                  <button className="ghost-button" onClick={() => setShowBookmarksOnly((current) => !current)} type="button">
                    {showBookmarksOnly ? 'Show All Cues' : 'Bookmarks Only'}
                  </button>
                </div>
                <p className="step-copy">Search for a distinctive caption, title card, or first spoken line.</p>
                <input
                  className="cue-search-input"
                  type="search"
                  placeholder="Search subtitle text"
                  value={cueSearch}
                  onChange={(event) => setCueSearch(event.target.value)}
                />

                {candidateCues.length > 0 ? (
                  <div className="candidate-panel">
                    <div className="compact-header">
                      <p className="eyebrow">Best Candidates</p>
                      <h3>{candidateCues.length} likely anchors</h3>
                    </div>
                    <div className="cue-list cue-list-compact">
                      {candidateCues.map((cue) => {
                        const isSelected = cue.index === selectedCueIndex;
                        const isBookmarked = bookmarkSet.has(cue.index);

                        return (
                          <div key={`candidate-${cue.index}`} className={`cue-list-item${isSelected ? ' is-selected' : ''}`}>
                            <div className="cue-list-button cue-readout">
                              <span className="cue-timestamp">{formatTimestamp(cue.startMs)}</span>
                              <span>{cue.text}</span>
                            </div>
                            <div className="cue-actions">
                              <button className="primary-button" onClick={() => selectCue(cue)} type="button">
                                Select Anchor
                              </button>
                              <button className="ghost-button" onClick={() => toggleBookmark(cue.index)} type="button">
                                {isBookmarked ? 'Unpin' : 'Pin'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="cue-list cue-list-scroll">
                  {filteredCues.map((cue) => {
                    const isSelected = cue.index === selectedCueIndex;
                    const isActive = cue.index === cueContext.activeCue?.index;
                    const isBookmarked = bookmarkSet.has(cue.index);

                    return (
                      <div
                        key={cue.index}
                        className={`cue-list-item${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                      >
                        <div className="cue-list-button cue-readout">
                          <span className="cue-timestamp">{formatTimestamp(cue.startMs)}</span>
                          <span>{cue.text}</span>
                        </div>
                        <div className="cue-actions">
                          <button className="primary-button" onClick={() => selectCue(cue)} type="button">
                            Select Anchor
                          </button>
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
                  {filteredCues.length === 0 ? <p className="empty-note">No cues match the current filter.</p> : null}
                </div>
              </>
            ) : null}

            {currentStep === 'inspect' ? (
              <>
                <div className="active-step-header">
                  <div>
                    <p className="eyebrow">Step 2</p>
                    <h3>Inspect the selected cue</h3>
                  </div>
                  <button className="ghost-button" onClick={returnToChooseStep} type="button">
                    Change Cue
                  </button>
                </div>
                {selectedCue ? (
                  <>
                    <p className="anchor-title">{selectedCue.text}</p>
                    <p className="step-copy">
                      Use the cue tools to land near the right moment, then scrub the player to the exact match in the video or audio.
                    </p>
                    <div className="detail-grid">
                      <div className="detail-chip">
                        <span className="cue-label">Cue Start</span>
                        <strong>{formatTimestamp(selectedCue.startMs)}</strong>
                      </div>
                      <div className="detail-chip">
                        <span className="cue-label">Preview</span>
                        <strong>{previewModeLabel}</strong>
                      </div>
                    </div>
                    <div className="replay-row">
                      <button className="ghost-button" onClick={() => jumpToCue(selectedCue)} type="button">
                        Jump To Cue
                      </button>
                      <button className="ghost-button" onClick={() => replayAroundCue(selectedCue)} type="button">
                        Replay Around Cue
                      </button>
                      <button className="primary-button" onClick={() => setCurrentStep('align')} type="button">
                        Ready To Align
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {currentStep === 'align' ? (
              <>
                <div className="active-step-header">
                  <div>
                    <p className="eyebrow">Step 3</p>
                    <h3>Align cue to the playhead</h3>
                  </div>
                  <button className="ghost-button" onClick={() => setCurrentStep('inspect')} type="button">
                    Back To Inspect
                  </button>
                </div>
                <p className="step-copy">When the playhead matches the cue in picture or audio, apply the derived global offset.</p>
                <div className="formula-card">
                  <span className="cue-label">Derived offset</span>
                  <strong>{proposedOffsetMs !== null ? msLabel(proposedOffsetMs) : 'Select a cue first'}</strong>
                  <span>playhead - cue start</span>
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
                <div className="align-actions">
                  <button className="primary-button" disabled={proposedOffsetMs === null} onClick={() => void applyAnchorAlignment()} type="button">
                    Align Here
                  </button>
                  <button className="ghost-button" onClick={() => setCurrentStep('inspect')} type="button">
                    Keep Checking
                  </button>
                </div>
              </>
            ) : null}

            {currentStep === 'verify' ? (
              <>
                <div className="active-step-header">
                  <div>
                    <p className="eyebrow">Step 4</p>
                    <h3>Verify and save</h3>
                  </div>
                  <button className="ghost-button" onClick={returnToChooseStep} type="button">
                    Choose Another Cue
                  </button>
                </div>
                <p className="step-copy">Use small nudges for final correction, spot check playback, then save the corrected sidecar subtitle.</p>
                <div className="detail-grid">
                  <div className="detail-chip">
                    <span className="cue-label">Applied offset</span>
                    <strong>{msLabel(session.offsetMs)}</strong>
                  </div>
                  <div className="detail-chip">
                    <span className="cue-label">Output</span>
                    <strong>{session.savedOutputPath ? 'Saved' : 'Pending save'}</strong>
                  </div>
                </div>
                <div className="nudge-row">
                  {[-500, -100, 100, 500].map((delta) => (
                    <button key={delta} className="ghost-button" onClick={() => void updateOffset(session.offsetMs + delta, 'verify')} type="button">
                      {delta > 0 ? `+${delta}` : delta} ms
                    </button>
                  ))}
                  <button className="ghost-button" onClick={() => void updateOffset(0, 'verify')} type="button">
                    Reset
                  </button>
                </div>
                <label className="offset-slider-label" htmlFor="offset-slider">
                  Fine-tune global offset
                </label>
                <input
                  id="offset-slider"
                  type="range"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={50}
                  value={Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, session.offsetMs))}
                  onChange={(event) => void updateOffset(Number(event.target.value), 'verify')}
                />
                <div className="replay-row">
                  <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs - 2000)} type="button">
                    Replay Back 2s
                  </button>
                  <button className="ghost-button" onClick={() => jumpVideoToMs(currentTimeMs + 2000)} type="button">
                    Skip Forward 2s
                  </button>
                  {selectedCue ? (
                    <button className="ghost-button" onClick={() => replayAroundCue(selectedCue)} type="button">
                      Replay Around Anchor
                    </button>
                  ) : null}
                </div>
                <div className="save-card">
                  <p className="cue-label">Output Path</p>
                  <p>{session.savedOutputPath ?? `${session.subtitleTrack.path} -> .aligned.srt`}</p>
                  <button className="primary-button" disabled={isSaving} onClick={() => void saveSession()} type="button">
                    {isSaving ? 'Saving...' : 'Save Corrected Subtitle'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <aside className="support-rail">
          <div className="support-card">
            <div className="compact-header">
              <p className="eyebrow">Session</p>
              <h3>Current media</h3>
            </div>
            <p className="support-title">{session.media.item.title}</p>
            <p>{previewHint}</p>
          </div>

          {media ? (
            <div className="support-card">
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
                  Only sidecar subtitle files stored alongside mapped media paths can be edited.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="support-card">
            <div className="compact-header">
              <p className="eyebrow">Playback context</p>
              <h3>Live subtitle view</h3>
            </div>
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

          <div className="support-card">
            <div className="compact-header">
              <p className="eyebrow">Navigator</p>
              <h3>{filteredCues.length} matching cues</h3>
            </div>
            <p>{bookmarkSet.size} bookmarked cue(s)</p>
            {selectedCue ? (
              <div className="mini-anchor-card">
                <span className="cue-label">Selected anchor</span>
                <strong>{formatTimestamp(selectedCue.startMs)}</strong>
                <p>{selectedCue.text}</p>
              </div>
            ) : (
              <p>No anchor selected yet.</p>
            )}
          </div>

          {previewStatus?.status === 'error' ? <p className="error-text">{previewStatus.errorMessage ?? 'Preview generation failed'}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </div>
    </section>
  );
}
