import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface PreviewRecord {
  sourcePath: string;
  previewPath: string;
  temporaryPath: string;
  windowStartMs: number;
  windowEndMs: number;
  status: 'preparing' | 'ready' | 'error';
  errorMessage?: string;
  job?: Promise<void>;
}

export interface PreviewStatus {
  status: 'preparing' | 'ready' | 'error';
  previewPath?: string;
  windowStartMs?: number;
  windowEndMs?: number;
  errorMessage?: string;
}

export class PreviewStore {
  private readonly records = new Map<string, PreviewRecord>();
  private readonly cacheDir = path.join(tmpdir(), 'subalignarr-previews');
  private readonly profileVersion = 'preview-v7';
  private readonly previewLeadInMs = 15000;
  private readonly previewDurationMs = 45000;

  isFfmpegAvailable(): boolean {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  }

  async ensure(sourcePath: string, aroundTimeMs = 0): Promise<PreviewStatus> {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const window = this.getPreviewWindow(aroundTimeMs);
    const previewPath = this.getPreviewPathForSource(sourcePath, window.windowStartMs, window.windowEndMs);
    const existing = this.records.get(previewPath);
    if (existsSync(previewPath)) {
      const readyRecord: PreviewRecord = {
        sourcePath,
        previewPath,
        temporaryPath: `${previewPath}.tmp.mp4`,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs,
        status: 'ready'
      };
      this.records.set(previewPath, readyRecord);
      return {
        status: 'ready',
        previewPath,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs
      };
    }

    if (existing?.status === 'preparing') {
      return {
        status: 'preparing',
        previewPath: existsSync(existing.temporaryPath) ? existing.temporaryPath : undefined,
        windowStartMs: existing.windowStartMs,
        windowEndMs: existing.windowEndMs
      };
    }

    if (existing?.status === 'error') {
      return {
        status: 'error',
        windowStartMs: existing.windowStartMs,
        windowEndMs: existing.windowEndMs,
        errorMessage: existing.errorMessage
      };
    }

    const record: PreviewRecord = {
      sourcePath,
      previewPath,
      temporaryPath: `${previewPath}.tmp.mp4`,
      windowStartMs: window.windowStartMs,
      windowEndMs: window.windowEndMs,
      status: 'preparing'
    };
    console.log(
      `[preview] start source="${sourcePath}" window=${this.labelWindow(window.windowStartMs, window.windowEndMs)} temp="${record.temporaryPath}"`
    );
    record.job = this.renderPreview(record);
    this.records.set(previewPath, record);
    return {
      status: 'preparing',
      windowStartMs: window.windowStartMs,
      windowEndMs: window.windowEndMs
    };
  }

  getStatus(sourcePath: string, aroundTimeMs = 0): PreviewStatus {
    const window = this.getPreviewWindow(aroundTimeMs);
    const previewPath = this.getPreviewPathForSource(sourcePath, window.windowStartMs, window.windowEndMs);
    if (existsSync(previewPath)) {
      return {
        status: 'ready',
        previewPath,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs
      };
    }

    const record = this.records.get(previewPath);
    if (!record) {
      return {
        status: 'preparing',
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs
      };
    }

    if (existsSync(record.temporaryPath)) {
      return {
        status: 'preparing',
        previewPath: record.temporaryPath,
        windowStartMs: record.windowStartMs,
        windowEndMs: record.windowEndMs
      };
    }

    return {
      status: record.status,
      windowStartMs: record.windowStartMs,
      windowEndMs: record.windowEndMs,
      errorMessage: record.errorMessage
    };
  }

  private getPreviewWindow(aroundTimeMs: number): { windowStartMs: number; windowEndMs: number } {
    const normalizedTimeMs = Math.max(0, Math.trunc(aroundTimeMs));
    const windowStartMs = Math.max(0, normalizedTimeMs - this.previewLeadInMs);
    return {
      windowStartMs,
      windowEndMs: windowStartMs + this.previewDurationMs
    };
  }

  private getPreviewPathForSource(sourcePath: string, windowStartMs: number, windowEndMs: number): string {
    const sourceStats = statSync(sourcePath);
    const digest = createHash('sha1')
      .update(`${this.profileVersion}:${sourcePath}:${sourceStats.size}:${sourceStats.mtimeMs}:${windowStartMs}:${windowEndMs}`)
      .digest('hex');
    return path.join(this.cacheDir, `${digest}.mp4`);
  }

  private labelWindow(windowStartMs: number, windowEndMs: number): string {
    return `${this.formatTimestamp(windowStartMs)}-${this.formatTimestamp(windowEndMs)}`;
  }

  private formatTimestamp(timeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private async renderPreview(record: PreviewRecord): Promise<void> {
    const startedAt = Date.now();
    const startSeconds = (record.windowStartMs / 1000).toFixed(3);
    const durationSeconds = ((record.windowEndMs - record.windowStartMs) / 1000).toFixed(3);
    const videoFilter = [
      'fps=8',
      'scale=-2:180:force_original_aspect_ratio=decrease',
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'tonemap=mobius',
      'zscale=p=bt709:t=bt709:m=bt709:r=tv',
      'format=yuv420p'
    ].join(',');
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      startSeconds,
      '-i',
      record.sourcePath,
      '-t',
      durationSeconds,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      videoFilter,
      '-pix_fmt',
      'yuv420p',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-preset',
      'ultrafast',
      '-crf',
      '40',
      '-g',
      '16',
      '-keyint_min',
      '16',
      '-sc_threshold',
      '0',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-b:a',
      '32k',
      '-ac',
      '1',
      '-movflags',
      '+empty_moov+default_base_moof+frag_keyframe',
      record.temporaryPath
    ];

    try {
      await fs.rm(record.temporaryPath, { force: true });
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
          if (stderr.length > 4000) {
            stderr = stderr.slice(-4000);
          }
        });
        console.log(`[preview] ffmpeg-spawn pid=${child.pid ?? 'unknown'} window=${this.labelWindow(record.windowStartMs, record.windowEndMs)}`);
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.trim()}` : ''}`));
        });
      });

      await fs.rename(record.temporaryPath, record.previewPath);
      record.status = 'ready';
      delete record.errorMessage;
      console.log(
        `[preview] ready window=${this.labelWindow(record.windowStartMs, record.windowEndMs)} duration_ms=${Date.now() - startedAt} output="${record.previewPath}"`
      );
    } catch (error) {
      await fs.rm(record.temporaryPath, { force: true }).catch(() => undefined);
      record.status = 'error';
      record.errorMessage = error instanceof Error ? error.message : 'Preview generation failed';
      console.error(
        `[preview] error window=${this.labelWindow(record.windowStartMs, record.windowEndMs)} duration_ms=${Date.now() - startedAt} message="${record.errorMessage}"`
      );
    }
  }
}
