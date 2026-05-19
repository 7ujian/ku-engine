import { readFile } from 'node:fs/promises';

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmData: Buffer; // raw PCM bytes starting at data chunk
}

export async function loadWav(absPath: string): Promise<WavInfo> {
  const raw = await readFile(absPath);
  return parseWav(raw);
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
