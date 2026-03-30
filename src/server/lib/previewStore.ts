import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface PreviewRecord {
  sourcePath: string;
  previewPath: string;
  temporaryPath: string;
  status: 'preparing' | 'ready' | 'error';
  errorMessage?: string;
  job?: Promise<void>;
}

export interface PreviewStatus {
  status: 'preparing' | 'ready' | 'error';
  previewPath?: string;
  errorMessage?: string;
}

export class PreviewStore {
  private readonly records = new Map<string, PreviewRecord>();
  private readonly cacheDir = path.join(tmpdir(), 'subalignarr-previews');
  private readonly profileVersion = 'preview-v1';

  async ensure(sourcePath: string): Promise<PreviewStatus> {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const previewPath = this.getPreviewPathForSource(sourcePath);
    const existing = this.records.get(previewPath);
    if (existsSync(previewPath)) {
      const readyRecord: PreviewRecord = {
        sourcePath,
        previewPath,
        temporaryPath: `${previewPath}.tmp`,
        status: 'ready'
      };
      this.records.set(previewPath, readyRecord);
      return { status: 'ready', previewPath };
    }

    if (existing?.status === 'preparing') {
      return { status: 'preparing' };
    }

    const record: PreviewRecord = {
      sourcePath,
      previewPath,
      temporaryPath: `${previewPath}.tmp`,
      status: 'preparing'
    };
    record.job = this.renderPreview(record);
    this.records.set(previewPath, record);
    return { status: 'preparing' };
  }

  getStatus(sourcePath: string): PreviewStatus {
    const previewPath = this.getPreviewPathForSource(sourcePath);
    if (existsSync(previewPath)) {
      return { status: 'ready', previewPath };
    }

    const record = this.records.get(previewPath);
    if (!record) {
      return { status: 'preparing' };
    }

    if (record.status === 'error') {
      return {
        status: 'error',
        errorMessage: record.errorMessage
      };
    }

    return { status: 'preparing' };
  }

  private getPreviewPathForSource(sourcePath: string): string {
    const digest = createHash('sha1').update(`${this.profileVersion}:${sourcePath}`).digest('hex');
    return path.join(this.cacheDir, `${digest}.mp4`);
  }

  private async renderPreview(record: PreviewRecord): Promise<void> {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      record.sourcePath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      'scale=-2:480:force_original_aspect_ratio=decrease',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-crf',
      '33',
      '-maxrate',
      '1200k',
      '-bufsize',
      '2400k',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      record.temporaryPath
    ];

    try {
      await fs.rm(record.temporaryPath, { force: true });
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`));
        });
      });

      await fs.rename(record.temporaryPath, record.previewPath);
      record.status = 'ready';
      delete record.errorMessage;
    } catch (error) {
      await fs.rm(record.temporaryPath, { force: true }).catch(() => undefined);
      record.status = 'error';
      record.errorMessage = error instanceof Error ? error.message : 'Preview generation failed';
    }
  }
}
