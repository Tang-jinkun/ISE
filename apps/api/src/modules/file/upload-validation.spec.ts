import { BadRequestException } from '@nestjs/common';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';
import { createHash } from 'crypto';
import { MAX_UPLOAD_SIZE_BYTES, validateUpload, type ValidatedUpload } from './upload-validation';

function file(
  originalname: string,
  mimetype: string,
  buffer: Buffer,
  size = buffer.length,
): Express.Multer.File {
  return { originalname, mimetype, buffer, size } as Express.Multer.File;
}

async function makeDocx(): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));

  const archive = archiver('zip');
  archive.pipe(output);
  archive.append('<Types/>', { name: '[Content_Types].xml' });
  archive.append('<document/>', { name: 'word/document.xml' });

  const finished = new Promise<void>((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  await archive.finalize();
  await finished;
  return Buffer.concat(chunks);
}

function makeGlb(): Buffer {
  const buffer = Buffer.alloc(12);
  buffer.write('glTF', 0, 'ascii');
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  return buffer;
}

function makeMp4(): Buffer {
  const buffer = Buffer.alloc(20);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  buffer.writeUInt32BE(0, 12);
  buffer.write('isom', 16, 'ascii');
  return buffer;
}

describe('upload validation', () => {
  let docx: Buffer;

  beforeAll(async () => {
    docx = await makeDocx();
  });

  it('uses the exact 25 MiB upload ceiling', () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(26_214_400);
  });

  it.each<{
    name: string;
    mime: string;
    bytes: () => Buffer;
    type: ValidatedUpload['storageType'];
  }>([
    {
      name: 'orders.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: () => docx,
      type: 'application',
    },
    { name: 'scene.glb', mime: 'model/gltf-binary', bytes: makeGlb, type: 'application' },
    { name: 'briefing.mp4', mime: 'video/mp4', bytes: makeMp4, type: 'video' },
    {
      name: 'overlay.png',
      mime: 'image/png',
      bytes: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      type: 'image',
    },
    {
      name: 'photo.jpg',
      mime: 'image/jpeg',
      bytes: () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
      type: 'image',
    },
    {
      name: 'terrain.tif',
      mime: 'image/tiff',
      bytes: () => Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      type: 'imageraster',
    },
    {
      name: 'config.json',
      mime: 'application/json',
      bytes: () => Buffer.from('{"enabled":true}'),
      type: 'json',
    },
    {
      name: 'route.geojson',
      mime: 'application/geo+json',
      bytes: () => Buffer.from('{"type":"FeatureCollection","features":[]}'),
      type: 'geojson',
    },
    {
      name: 'captions.srt',
      mime: 'application/x-subrip',
      bytes: () => Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nReady\n'),
      type: 'text',
    },
    {
      name: 'notes.txt',
      mime: 'text/plain',
      bytes: () => Buffer.from('ready\n'),
      type: 'text',
    },
    {
      name: 'report.pdf',
      mime: 'application/pdf',
      bytes: () => Buffer.from('%PDF-1.7\n'),
      type: 'application',
    },
  ])('accepts a valid $name and derives $type storage', ({ name, mime, bytes, type }) => {
    const buffer = bytes();

    expect(validateUpload(file(name, mime, buffer))).toEqual({
      buffer,
      fileName: name,
      mimeType: mime,
      size: buffer.length,
      storageType: type,
      fingerprint: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    });
  });

  it('normalizes a safe UTF-8 basename before validating its extension', () => {
    const originalname = Buffer.from('路线.txt', 'utf8').toString('latin1');
    const buffer = Buffer.from('valid UTF-8');

    expect(validateUpload(file(originalname, 'text/plain', buffer)).fileName).toBe('路线.txt');
  });

  it.each([
    ['wrong MIME', 'overlay.png', 'image/jpeg', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['wrong extension', 'overlay.exe', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['wrong magic', 'overlay.png', 'image/png', Buffer.from('%PDF-1.7')],
    ['truncated JPEG', 'photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      'forged DOCX markers',
      'orders.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('[Content_Types].xml word/document.xml'),
        Buffer.from([0x50, 0x4b, 0x05, 0x06]),
        Buffer.alloc(18),
      ]),
    ],
    ['unsupported type', 'archive.zip', 'application/zip', Buffer.from('PK\u0003\u0004')],
  ])('rejects %s before upload', (_case, name, mime, buffer) => {
    expect(() => validateUpload(file(name, mime, buffer))).toThrow(BadRequestException);
  });

  it.each([
    '../route.geojson',
    '..\\route.geojson',
    '/tmp/route.geojson',
    ' route.geojson',
    'route.geojson ',
  ])('rejects the unsafe filename %s', (name) => {
    const buffer = Buffer.from('{"type":"FeatureCollection","features":[]}');
    expect(() => validateUpload(file(name, 'application/geo+json', buffer))).toThrow(
      BadRequestException,
    );
  });

  it('rejects oversized actual bytes even when the caller reports a smaller size', () => {
    const buffer = Buffer.alloc(MAX_UPLOAD_SIZE_BYTES + 1, 0x61);

    expect(() => validateUpload(file('oversized.txt', 'text/plain', buffer, 1))).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['primitive JSON root', 'config.json', 'application/json', Buffer.from('true')],
    [
      'invalid GeoJSON root',
      'route.geojson',
      'application/geo+json',
      Buffer.from('{"type":"NotGeoJSON"}'),
    ],
    ['NUL text', 'notes.txt', 'text/plain', Buffer.from('hello\u0000world')],
    ['invalid UTF-8 text', 'notes.txt', 'text/plain', Buffer.from([0xc3, 0x28])],
  ])('rejects %s', (_case, name, mime, buffer) => {
    expect(() => validateUpload(file(name, mime, buffer))).toThrow(BadRequestException);
  });

  it('rejects a GLB whose declared length does not match the uploaded bytes', () => {
    const glb = makeGlb();
    glb.writeUInt32LE(glb.length + 4, 8);

    expect(() => validateUpload(file('scene.glb', 'model/gltf-binary', glb))).toThrow(
      BadRequestException,
    );
  });
});
