export type BrowseItemType = 'folder' | 'video';

export interface BrowseItem {
  id: string;
  parentId: string | null;
  title: string;
  type: BrowseItemType;
  durationMs?: number;
}

export interface Library {
  id: string;
  name: string;
}

export interface SubtitleTrack {
  id: string;
  path: string;
  language: string | null;
  format: string;
  isExternal: boolean;
  isEditable: boolean;
  warning?: string;
}

export interface MediaDetails {
  item: BrowseItem;
  mediaPath: string;
  mediaSourceId: string | null;
  subtitleTracks: SubtitleTrack[];
}

export interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CuePreview {
  previousCue: Cue | null;
  activeCue: Cue | null;
  nextCue: Cue | null;
}

export interface PreviewStatusResponse {
  status: 'preparing' | 'ready' | 'error';
  streamUrl?: string;
  errorMessage?: string;
}

export interface SessionSummary {
  sessionId: string;
  media: MediaDetails;
  subtitleTrack: SubtitleTrack;
  offsetMs: number;
  dirty: boolean;
  savedOutputPath?: string;
}

export interface HealthResponse {
  ok: boolean;
  mode: 'mock' | 'live';
  config: {
    baseUrlConfigured: boolean;
    apiKeyConfigured: boolean;
    userIdConfigured: boolean;
    pathMappingCount: number;
  };
}
