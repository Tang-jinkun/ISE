import { describe, expect, it } from 'vitest';
import { parseMp4Metadata } from './runtimeCatalogMetadata';

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function ascii(value: string) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(...payload);
  return concat(uint32(body.length + 8), ascii(type), body);
}

function fixtureMp4() {
  const mvhd = box(
    'mvhd',
    new Uint8Array(12),
    uint32(1_000),
    uint32(2_400),
  );
  const avcConfiguration = box(
    'avcC',
    Uint8Array.from([1, 0x64, 0, 0x28]),
  );
  const avcSampleEntry = box(
    'avc1',
    new Uint8Array(78),
    avcConfiguration,
  );
  const stsd = box(
    'stsd',
    new Uint8Array(4),
    uint32(1),
    avcSampleEntry,
  );
  const sampleTable = box('stbl', stsd);
  const media = box('mdia', box('minf', sampleTable));
  return concat(
    box('ftyp', ascii('isom'), uint32(0), ascii('isomavc1')),
    box('moov', mvhd, box('trak', media)),
  );
}

describe('parseMp4Metadata', () => {
  it('parses deterministic movie duration and AVC codec details', () => {
    expect(parseMp4Metadata(fixtureMp4())).toEqual({
      durationMs: 2_400,
      codec: 'avc1.640028',
    });
  });
});
