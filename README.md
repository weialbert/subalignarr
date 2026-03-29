# subalignarr

`subalignarr` is a standalone subtitle alignment web app for Jellyfin libraries. It is designed for headless NAS deployments where you want a browser-based editor to preview a video, shift an external subtitle track earlier or later, and save a corrected sidecar `.srt` without overwriting the source file.

## Current scope

- Jellyfin library browsing
- External subtitle discovery
- Browser video preview through the app backend
- Global subtitle offset with slider and nudge controls
- Live subtitle overlay preview
- Non-destructive `.srt` export
- Mock mode for UI/API development without a real Jellyfin server

## Stack

- React + Vite + TypeScript frontend
- Express + TypeScript backend
- In-memory edit sessions
- Dockerized standalone deployment

## Local development

1. Copy `.env.example` to `.env`.
2. Set `USE_MOCK_DATA=true` for local development without Jellyfin.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:5173`.

The Vite dev server proxies API requests to the backend on `http://localhost:3001`.
Mock mode includes a tiny bundled MP4 so the editor can preview playback without a real Jellyfin-backed media file.

## Test on your machine

### Fastest local smoke test

1. `cd /Users/albertwei/workspace/subalignarr`
2. `cp .env.example .env`
3. In `.env`, keep `USE_MOCK_DATA=true`
4. `npm install`
5. `npm run dev`
6. Open `http://localhost:5173`
7. In the UI:
   - open `Mock Library`
   - open `Movies`
   - select `Arrival` or `Interstellar`
   - confirm the video preview loads
   - move the offset slider and watch the subtitle overlay timing change
   - click `Save corrected subtitle`
8. Confirm a new file appears in the project root named like `Arrival.aligned.srt`

### Production-style local run

1. `cd /Users/albertwei/workspace/subalignarr`
2. `cp .env.example .env`
3. Set `USE_MOCK_DATA=true`
4. `npm install`
5. `npm run build`
6. `APP_PORT=3000 npm run start`
7. Open `http://localhost:3000`

### Test against your real Jellyfin instance

1. `cd /Users/albertwei/workspace/subalignarr`
2. `cp .env.example .env`
3. Set:
   - `USE_MOCK_DATA=false`
   - `JELLYFIN_BASE_URL` to your Jellyfin URL, for example `http://<nas-ip>:8096`
   - `JELLYFIN_API_KEY` to a valid Jellyfin API key
   - `JELLYFIN_USER_ID` to the user id you want to browse as
   - `MEDIA_PATH_MAPPINGS` so Jellyfin paths map to local mounted paths inside the app environment
4. If running directly on your machine, mount or expose the same media paths locally.
5. Run `npm run dev` or `npm run build && npm run start`
6. Open the app, browse to an item with an external `.srt`, and confirm save creates a new sidecar subtitle file.

### Docker test

1. `cd /Users/albertwei/workspace/subalignarr`
2. `cp .env.example .env`
3. Adjust `.env` and `docker-compose.yml` volume mounts for your machine
4. `docker compose up --build`
5. Open `http://localhost:3000`

## Production

1. Set real Jellyfin values in `.env`.
2. Configure `MEDIA_PATH_MAPPINGS` so Jellyfin-visible paths map to container-mounted paths.
3. Make sure the mounted media path is readable and the subtitle directory is writable.
4. Build and run with Docker Compose.

## Environment

- `APP_PORT`: backend HTTP port
- `JELLYFIN_BASE_URL`: Jellyfin base URL
- `JELLYFIN_API_KEY`: Jellyfin API key
- `JELLYFIN_USER_ID`: Jellyfin user id used for library browsing
- `MEDIA_PATH_MAPPINGS`: semicolon-separated prefix mappings, for example `/media=/mnt/media;/shows=/mnt/shows`
- `DEFAULT_OUTPUT_SUFFIX`: suffix for generated subtitle files
- `ALLOW_OVERWRITE`: overwrite generated files if they already exist
- `USE_MOCK_DATA`: bypass Jellyfin and filesystem dependencies for development
