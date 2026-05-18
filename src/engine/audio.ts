import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sdl = (() => {
  try { return require('@kmamal/sdl'); }
  catch { return null; }
})();

interface ActiveSound {
  buffer: Buffer;
  offset: number; // byte offset into pcm data
  volume: number;
  loop: boolean;
}

interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmData: Buffer; // raw PCM bytes starting at data chunk
}

export class AudioManager {
  private device: ReturnType<typeof sdl.audio.openDevice> | null = null;
  private cache = new Map<string, WavInfo>();
  private active = new Map<string, ActiveSound>();
  private projectDir: string;
  private deviceFrequency = 44100;
  private deviceChannels = 2;
  private started = false;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async play(nodeId: string, stream: string, volume: number, loop = false): Promise<void> {
    if (!sdl) return;
    if (!stream) return;

    const absPath = resolve(this.projectDir, stream);
    let wav = this.cache.get(absPath);
    if (!wav) {
      const raw = await readFile(absPath);
      wav = parseWav(raw);
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

function parseWav(raw: Buffer): WavInfo {
  if (raw.length < 44) throw new Error('WAV file too small');
  if (raw.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
  if (raw.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAVE file');

  // Find fmt chunk
  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset < raw.length - 8) {
    const chunkId = raw.toString('ascii', offset, offset + 4);
    const chunkSize = raw.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      fmtOffset = offset + 8;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break; // data is always last
    }
    offset += 8 + chunkSize;
  }

  if (fmtOffset < 0) throw new Error('no fmt chunk in WAV');
  if (dataOffset < 0) throw new Error('no data chunk in WAV');

  const audioFormat = raw.readUInt16LE(fmtOffset);
  if (audioFormat !== 1) throw new Error('only PCM WAV supported');

  const channels = raw.readUInt16LE(fmtOffset + 2);
  const sampleRate = raw.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = raw.readUInt16LE(fmtOffset + 14);

  const pcmData = raw.subarray(dataOffset, dataOffset + dataSize);

  return { sampleRate, channels, bitsPerSample, pcmData };
}
