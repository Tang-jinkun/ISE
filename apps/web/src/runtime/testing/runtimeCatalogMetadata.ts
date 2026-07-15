export type ParsedMp4Metadata = {
  durationMs: number;
  codec: string;
};

type Mp4Box = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
};

const containerTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

function readType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function readBoxes(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw new Error('Invalid MP4 box header');
    const size32 = view.getUint32(offset);
    const type = readType(bytes, offset + 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) throw new Error('Invalid extended MP4 box header');
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('MP4 box is too large');
      }
      headerSize = 16;
      size = Number(extendedSize);
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      throw new Error(`Invalid MP4 box size for ${type}`);
    }
    boxes.push({
      type,
      start: offset,
      dataStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }
  return boxes;
}

function findBox(bytes: Uint8Array, type: string) {
  const pending = [...readBoxes(bytes)];
  while (pending.length > 0) {
    const box = pending.shift()!;
    if (box.type === type) return box;
    if (containerTypes.has(box.type)) {
      pending.push(...readBoxes(bytes, box.dataStart, box.end));
    }
  }
  return undefined;
}

function parseDurationMs(bytes: Uint8Array) {
  const box = findBox(bytes, 'mvhd');
  if (!box) throw new Error('MP4 movie header is missing');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[box.dataStart];
  let timescale: number;
  let duration: number;
  if (version === 0) {
    if (box.end - box.dataStart < 20) throw new Error('Invalid version 0 movie header');
    timescale = view.getUint32(box.dataStart + 12);
    duration = view.getUint32(box.dataStart + 16);
  } else if (version === 1) {
    if (box.end - box.dataStart < 32) throw new Error('Invalid version 1 movie header');
    timescale = view.getUint32(box.dataStart + 20);
    const duration64 = view.getBigUint64(box.dataStart + 24);
    if (duration64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('MP4 duration is too large');
    }
    duration = Number(duration64);
  } else {
    throw new Error(`Unsupported movie header version ${version}`);
  }
  const durationMs = Math.round((duration / timescale) * 1_000);
  if (timescale === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('MP4 movie duration is invalid');
  }
  return durationMs;
}

function parseCodec(bytes: Uint8Array) {
  const stsd = findBox(bytes, 'stsd');
  if (!stsd || stsd.end - stsd.dataStart < 8) {
    throw new Error('MP4 sample description is missing');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint32(stsd.dataStart + 4);
  const entries = readBoxes(bytes, stsd.dataStart + 8, stsd.end);
  if (entries.length !== entryCount) {
    throw new Error('MP4 sample description count is invalid');
  }
  for (const entry of entries) {
    if (entry.type !== 'avc1' && entry.type !== 'avc3') continue;
    const configurationStart = entry.dataStart + 78;
    if (configurationStart > entry.end) throw new Error('Invalid AVC sample entry');
    const configuration = readBoxes(bytes, configurationStart, entry.end).find(
      (box) => box.type === 'avcC',
    );
    if (!configuration || configuration.end - configuration.dataStart < 4) {
      throw new Error('AVC configuration is missing');
    }
    const profile = bytes[configuration.dataStart + 1]!;
    const compatibility = bytes[configuration.dataStart + 2]!;
    const level = bytes[configuration.dataStart + 3]!;
    const detail = [profile, compatibility, level]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return `${entry.type}.${detail}`;
  }
  throw new Error('MP4 video codec is unsupported');
}

export function parseMp4Metadata(bytes: Uint8Array): ParsedMp4Metadata {
  if (bytes.byteLength < 8 || readBoxes(bytes)[0]?.type !== 'ftyp') {
    throw new Error('MP4 file type box is missing');
  }
  return {
    durationMs: parseDurationMs(bytes),
    codec: parseCodec(bytes),
  };
}
