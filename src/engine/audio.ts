import type { WavInfo } from '../persistence/audio-loader.js';

const sdl = (() => {
  try { return require('@kmamal/sdl'); }
  catch { return null; }
})();

interface ActiveSound {
  buffer: Buffer;
  offset: number;
  volume: number;
  loop: boolean;
}

export interface AudioLoadFn {
  (absPath: string): Promise<WavInfo>;
}

export class AudioManager {
  private device: ReturnType<typeof sdl.audio.openDevice> | null = null;
  private cache = new Map<string, WavInfo>();
  private active = new Map<string, ActiveSound>();
  private loadWav: AudioLoadFn;
  private projectDir: string;
  private deviceFrequency = 44100;
  private deviceChannels = 2;
  private started = false;

  constructor(projectDir: string, loadWavFn?: AudioLoadFn) {
    this.projectDir = projectDir;
    this.loadWav = loadWavFn ?? (async () => { throw new Error('no audio loader provided'); });
  }

  async play(nodeId: string, stream: string, volume: number, loop = false): Promise<void> {
    if (!sdl) return;
    if (!stream) return;

    const { resolve } = await import('node:path');
    const absPath = resolve(this.projectDir, stream);
    let wav = this.cache.get(absPath);
    if (!wav) {
      wav = await this.loadWav(absPath);
      this.cache.set(absPath, wav);
    }

    this.active.set(nodeId, { buffer: wav.pcmData, offset: 0, volume, loop });
    this.ensureDevice(wav.sampleRate, wav.channels);
  }

  stop(nodeId: string): void {
    this.active.delete(nodeId);
    if (this.active.size === 0 && this.device) {
      this.device.clearQueue();
    }
  }

  tick(): void {
    if (!sdl || !this.device || this.device.closed) return;

    // Keep the device buffer fed: enqueue chunks when queue is low
    const QUEUE_TARGET = 4; // target number of queued chunks
    const CHUNK_FRAMES = 1024; // frames per chunk
    const queued = this.device.queued;

    if (queued < QUEUE_TARGET * CHUNK_FRAMES * this.deviceChannels * 2) {
      // Mix active sounds into a chunk and enqueue
      const chunk = this.mixChunk(CHUNK_FRAMES);
      if (chunk.length > 0) {
        this.device.enqueue(chunk);
      }
    }
  }

  destroy(): void {
    if (this.device && !this.device.closed) {
      this.device.close();
    }
    this.device = null;
    this.active.clear();
    this.cache.clear();
  }

  private ensureDevice(sampleRate: number, channels: number): void {
    if (this.device && !this.device.closed) return;

    if (!sdl) return;
    this.device = sdl.audio.openDevice(
      { type: 'playback' },
      {
        frequency: sampleRate,
        channels,
        format: 's16',
        buffered: 4096,
      },
    );
    this.device.play();
  }

  private mixChunk(frames: number): Buffer {
    const formatBytes = 2; // s16 = 2 bytes per sample
    const chunkSize = frames * this.deviceChannels * formatBytes;
    const mixed = Buffer.alloc(chunkSize);
    let hasData = false;

    for (const [, sound] of this.active) {
      const samplesAvailable = Math.floor((sound.buffer.length - sound.offset) / formatBytes);
      if (samplesAvailable <= 0) {
        if (sound.loop) {
          sound.offset = 0;
        } else {
          this.active.delete(sound.buffer.toString()); // will be cleaned up next iteration
          continue;
        }
      }

      hasData = true;
      const framesToMix = Math.min(frames, Math.floor((sound.buffer.length - sound.offset) / (this.deviceChannels * formatBytes)));

      for (let i = 0; i < framesToMix * this.deviceChannels; i++) {
        const srcOff = sound.offset + i * formatBytes;
        if (srcOff + 1 >= sound.buffer.length) break;

        // Read s16 sample from source
        const srcSample = sound.buffer.readInt16LE(srcOff);

        // Read existing s16 sample from mixed buffer
        const dstOff = i * formatBytes;
        const dstSample = mixed.readInt16LE(dstOff);

        // Mix with volume, clamp to s16 range
        const vol = sound.volume;
        const newSample = Math.round(dstSample + srcSample * vol);
        const clamped = Math.max(-32768, Math.min(32767, newSample));
        mixed.writeInt16LE(clamped, dstOff);
      }

      sound.offset += framesToMix * this.deviceChannels * formatBytes;
    }

    // Cleanup finished non-looping sounds
    for (const [id, sound] of this.active) {
      if (sound.offset >= sound.buffer.length && !sound.loop) {
        this.active.delete(id);
      }
    }

    return hasData ? mixed : Buffer.alloc(0);
  }
}
