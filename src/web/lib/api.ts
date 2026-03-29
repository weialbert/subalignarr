import { BrowseItem, CuePreview, HealthResponse, Library, MediaDetails, SessionSummary } from '../../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: response.statusText }))) as { message?: string };
    throw new Error(body.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  getHealth: () => request<HealthResponse>('/api/health'),
  getLibraries: () => request<Library[]>('/api/libraries'),
  getItems: (parentId?: string) =>
    request<BrowseItem[]>(parentId ? `/api/items?parentId=${encodeURIComponent(parentId)}` : '/api/items'),
  getMedia: (itemId: string) => request<MediaDetails>(`/api/media/${itemId}`),
  createSession: (itemId: string, subtitleTrackId: string) =>
    request<SessionSummary>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ itemId, subtitleTrackId })
    }),
  updateOffset: (sessionId: string, offsetMs: number) =>
    request<SessionSummary>(`/api/sessions/${sessionId}/offset`, {
      method: 'POST',
      body: JSON.stringify({ offsetMs })
    }),
  getCuePreview: (sessionId: string, timeMs: number) =>
    request<CuePreview>(`/api/sessions/${sessionId}/cues?timeMs=${Math.max(0, Math.floor(timeMs))}`),
  saveSession: (sessionId: string) =>
    request<SessionSummary>(`/api/sessions/${sessionId}/save`, {
      method: 'POST'
    })
};
