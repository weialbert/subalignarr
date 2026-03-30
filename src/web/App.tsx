import { useEffect, useState } from 'react';
import { BrowseItem, HealthResponse, Library, MediaDetails, SessionSummary } from '../shared/types';
import { EditorPane } from './components/EditorPane';
import { LibraryBrowser } from './components/LibraryBrowser';
import { api } from './lib/api';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [currentParentId, setCurrentParentId] = useState<string | undefined>();
  const [selectedMedia, setSelectedMedia] = useState<MediaDetails | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isOpeningItem, setIsOpeningItem] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [healthData, libraryData] = await Promise.all([api.getHealth(), api.getLibraries()]);
        setHealth(healthData);
        setLibraries(libraryData);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load app health');
      }
    })();
  }, []);

  async function openParent(parentId?: string) {
    try {
      setError(null);
      setCurrentParentId(parentId);
      setSelectedMedia(null);
      setSelectedTrackId(null);
      setSession(null);

      if (!parentId) {
        setItems([]);
        return;
      }

      setIsLoadingItems(true);
      const nextItems = await api.getItems(parentId);
      setItems(nextItems);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to browse items');
    } finally {
      setIsLoadingItems(false);
    }
  }

  async function selectItem(item: BrowseItem) {
    if (item.type === 'folder') {
      await openParent(item.id);
      return;
    }

    try {
      setError(null);
      setIsOpeningItem(true);
      const media = await api.getMedia(item.id);
      setSelectedMedia(media);

      const preferredTrack =
        media.subtitleTracks.find((track) => track.isEditable && track.format === 'srt') ??
        media.subtitleTracks.find((track) => track.isEditable);
      if (!preferredTrack) {
        throw new Error('No supported sidecar subtitle tracks found for this media item.');
      }

      await selectSubtitleTrack(media, preferredTrack.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to open media item');
    } finally {
      setIsOpeningItem(false);
    }
  }

  async function selectSubtitleTrack(media: MediaDetails, subtitleTrackId: string) {
    setError(null);
    setSelectedTrackId(subtitleTrackId);
    const nextSession = await api.createSession(media.item.id, subtitleTrackId);
    setSession(nextSession);
  }

  async function changeSelectedTrack(subtitleTrackId: string) {
    if (!selectedMedia || subtitleTrackId === selectedTrackId) {
      return;
    }

    try {
      setError(null);
      setIsOpeningItem(true);
      await selectSubtitleTrack(selectedMedia, subtitleTrackId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to switch subtitle track');
    } finally {
      setIsOpeningItem(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-block">
          <p className="eyebrow">Anchor-based subtitle sync</p>
          <h1>subalignarr</h1>
          <p className="hero-copy">Find a cue, match it to the media, apply a global offset, then verify and save.</p>
        </div>
        <div className="utility-stack">
          <div className="utility-card">
            <p className="eyebrow">Backend</p>
            <p>{health ? `${health.mode} mode` : 'Checking status...'}</p>
          </div>
          <div className="utility-card">
            <p className="eyebrow">Mappings</p>
            <p>{health ? `${health.config.pathMappingCount} configured` : '...'}</p>
          </div>
          {selectedMedia ? (
            <div className="utility-card">
              <p className="eyebrow">Active media</p>
              <p>{selectedMedia.item.title}</p>
            </div>
          ) : null}
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {isOpeningItem ? <div className="status-banner">Opening media, loading subtitles, and preparing the workflow…</div> : null}

      <div className={`workspace-grid${session ? ' is-session-active' : ''}`}>
        <LibraryBrowser
          activeMediaTitle={selectedMedia?.item.title ?? null}
          currentParentId={currentParentId}
          hasActiveSession={Boolean(session)}
          isLoading={isLoadingItems}
          items={items}
          libraries={libraries}
          onOpenParent={openParent}
          onSelectItem={selectItem}
        />
        <EditorPane
          media={selectedMedia}
          onSelectTrack={changeSelectedTrack}
          onSessionChange={setSession}
          selectedTrackId={selectedTrackId}
          session={session}
        />
      </div>
    </main>
  );
}
