import { BrowseItem, Library, MediaDetails, SubtitleTrack } from '../../shared/types.js';
import { AppConfig } from '../config.js';
import { hasMatchingMapping } from './pathMapping.js';

interface JellyfinItemResponse {
  Id: string;
  Name: string;
  Type?: string;
  RunTimeTicks?: number;
  Path?: string;
  ParentId?: string;
  MediaSources?: Array<{
    Id?: string;
    Path?: string;
    MediaStreams?: Array<{
      Index?: number;
      Type?: string;
      Language?: string;
      Codec?: string;
      IsExternal?: boolean;
      Path?: string;
      DisplayTitle?: string;
    }>;
  }>;
}

const BROWSABLE_ITEM_TYPES = new Set(['Folder', 'Series', 'Season', 'BoxSet', 'Playlist']);

const MOCK_LIBRARY: Library[] = [{ id: 'mock-library', name: 'Mock Library' }];

const MOCK_ITEMS: BrowseItem[] = [
  { id: 'folder-movies', parentId: 'mock-library', title: 'Movies', type: 'folder' },
  { id: 'movie-arrival', parentId: 'folder-movies', title: 'Arrival', type: 'video', durationMs: 6960000 },
  { id: 'movie-interstellar', parentId: 'folder-movies', title: 'Interstellar', type: 'video', durationMs: 10140000 }
];

export class JellyfinClient {
  constructor(private readonly config: AppConfig) {}

  private createPreviewQuery(mediaSourceId: string | null): URLSearchParams {
    const query = new URLSearchParams({
      static: 'false',
      videoCodec: 'h264',
      audioCodec: 'aac',
      allowVideoStreamCopy: 'false',
      allowAudioStreamCopy: 'false',
      maxWidth: '854',
      maxHeight: '480',
      videoBitRate: '1200000',
      audioBitRate: '128000',
      maxFramerate: '24'
    });

    if (mediaSourceId) {
      query.set('mediaSourceId', mediaSourceId);
    }

    return query;
  }

  async listLibraries(): Promise<Library[]> {
    if (this.config.useMockData) {
      return MOCK_LIBRARY;
    }

    const response = await this.request<{ Items: Array<{ Name: string; Id: string }> }>('/Library/MediaFolders');
    return response.Items.map((item) => ({
      id: item.Id,
      name: item.Name
    }));
  }

  async listItems(parentId?: string): Promise<BrowseItem[]> {
    if (this.config.useMockData) {
      if (!parentId) {
        return MOCK_LIBRARY.map((library) => ({
          id: library.id,
          parentId: null,
          title: library.name,
          type: 'folder' as const
        }));
      }

      return MOCK_ITEMS.filter((item) => item.parentId === parentId);
    }

    const query = new URLSearchParams({
      ParentId: parentId ?? '',
      Recursive: 'false',
      Fields: 'Path,MediaSources',
      IncludeItemTypes: 'Movie,Episode,Folder,Series,Season,BoxSet,Playlist',
      SortBy: 'SortName'
    });
    const response = await this.request<{ Items: JellyfinItemResponse[] }>(
      `/Users/${this.config.jellyfinUserId}/Items?${query.toString()}`
    );

    return response.Items.map((item) => ({
      id: item.Id,
      parentId: item.ParentId ?? parentId ?? null,
      title: item.Name,
      type: BROWSABLE_ITEM_TYPES.has(item.Type ?? '') ? 'folder' : 'video',
      durationMs: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10_000) : undefined
    }));
  }

  async getMediaDetails(itemId: string): Promise<MediaDetails> {
    if (this.config.useMockData) {
      const item = MOCK_ITEMS.find((entry) => entry.id === itemId);
      if (!item) {
        throw new Error(`Unknown mock item: ${itemId}`);
      }

      const subtitleTracks: SubtitleTrack[] = [
        {
          id: `${itemId}-en`,
          path: `/media/${item.title}/subtitle.en.srt`,
          language: 'eng',
          format: 'srt',
          isExternal: true,
          isEditable: true
        }
      ];

      return {
        item,
        mediaPath: `/media/${item.title}/${item.title}.mp4`,
        mediaSourceId: item.id,
        subtitleTracks
      };
    }

    const response = await this.request<JellyfinItemResponse>(`/Users/${this.config.jellyfinUserId}/Items/${itemId}`);
    const mediaSource = response.MediaSources?.[0];
    const mediaPath = response.Path ?? mediaSource?.Path;
    if (!mediaPath) {
      throw new Error(`No media path found for item ${itemId}`);
    }

    const subtitleTracks = (response.MediaSources?.[0]?.MediaStreams ?? [])
      .filter((stream) => stream.Type === 'Subtitle' && stream.IsExternal && stream.Path)
      .map((stream) => ({
        id: `${itemId}-${stream.Index ?? stream.Path}`,
        path: stream.Path as string,
        language: stream.Language ?? null,
        format: stream.Codec ?? 'srt',
        isExternal: true,
        isEditable: hasMatchingMapping(stream.Path as string, this.config.pathMappings),
        warning: hasMatchingMapping(stream.Path as string, this.config.pathMappings)
          ? undefined
          : 'Unsupported subtitle path. Only sidecar subtitles stored alongside mapped media files can be edited.'
      }));

    return {
      item: {
        id: response.Id,
        parentId: response.ParentId ?? null,
        title: response.Name,
        type: 'video',
        durationMs: response.RunTimeTicks ? Math.floor(response.RunTimeTicks / 10_000) : undefined
      },
      mediaPath,
      mediaSourceId: mediaSource?.Id ?? null,
      subtitleTracks
    };
  }

  getVideoPlaylistPath(itemId: string, mediaSourceId: string | null): string {
    return `/Videos/${itemId}/master.m3u8?${this.createPreviewQuery(mediaSourceId).toString()}`;
  }

  async requestPlaybackResource(pathAndQuery: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = {
      'X-Emby-Token': this.config.jellyfinApiKey
    };
    if (range) {
      headers.range = range;
    }

    const response = await fetch(`${this.config.jellyfinBaseUrl}${pathAndQuery}`, {
      headers
    });

    if (!response.ok) {
      throw new Error(`Jellyfin playback request failed with ${response.status} ${response.statusText}`);
    }

    return response;
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.config.jellyfinBaseUrl || !this.config.jellyfinApiKey || !this.config.jellyfinUserId) {
      throw new Error('Jellyfin configuration is incomplete. Set USE_MOCK_DATA=true for local development.');
    }

    const response = await fetch(`${this.config.jellyfinBaseUrl}${path}`, {
      headers: {
        'X-Emby-Token': this.config.jellyfinApiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Jellyfin request failed with ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
