import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as path from 'path';

export const MAX_UPLOAD_SIZE_BYTES = 26_214_400;

export type UploadStorageType =
  'application' | 'geojson' | 'image' | 'imageraster' | 'json' | 'text' | 'video';

export interface ValidatedUpload {
  buffer: Buffer;
  fileName: string;
  fingerprint: string;
  mimeType: string;
  size: number;
  storageType: UploadStorageType;
}

interface FileFormat {
  mimeTypes: readonly string[];
  storageType: UploadStorageType;
  validate: (buffer: Buffer) => boolean;
}

const GEOJSON_TYPES = new Set([
  'Feature',
  'FeatureCollection',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const earliestOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= earliestOffset; offset -= 1) {
    if (
      buffer.subarray(offset, offset + 4).equals(ZIP_END_OF_CENTRAL_DIRECTORY) &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      return offset;
    }
  }
  return -1;
}

function hasDocxZipStructure(buffer: Buffer): boolean {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0 || buffer.readUInt16LE(eocdOffset + 4) !== 0) {
    return false;
  }

  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    totalEntries === 0 ||
    entriesOnDisk !== totalEntries ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    return false;
  }

  const names = new Set<string>();
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocdOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      return false;
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (
      entryEnd > eocdOffset ||
      localHeaderOffset + 30 > centralDirectoryOffset ||
      buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      return false;
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    if (localNameStart + localNameLength + localExtraLength > centralDirectoryOffset) {
      return false;
    }

    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const localNameBytes = buffer.subarray(localNameStart, localNameStart + localNameLength);
    const name = decodeUtf8(nameBytes);
    if (name === undefined || !nameBytes.equals(localNameBytes)) {
      return false;
    }
    names.add(name);
    cursor = entryEnd;
  }

  return (
    cursor === eocdOffset && names.has('[Content_Types].xml') && names.has('word/document.xml')
  );
}

function isDocx(buffer: Buffer): boolean {
  if (!startsWith(buffer, ZIP_LOCAL_FILE_HEADER)) {
    return false;
  }
  try {
    return hasDocxZipStructure(buffer);
  } catch {
    return false;
  }
}

function isGlb(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'glTF' &&
    buffer.readUInt32LE(4) === 2 &&
    buffer.readUInt32LE(8) === buffer.length
  );
}

function isMp4(buffer: Buffer): boolean {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return false;
  }
  const boxSize = buffer.readUInt32BE(0);
  return boxSize === 0 || (boxSize >= 12 && boxSize <= buffer.length);
}

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 5 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  );
}

function isTiff(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  );
}

function decodeUtf8(buffer: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

function parseJson(buffer: Buffer): unknown {
  const text = decodeUtf8(buffer);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

function isStructuredJson(buffer: Buffer): boolean {
  const value = parseJson(buffer);
  return value !== null && typeof value === 'object';
}

function isGeoJson(buffer: Buffer): boolean {
  const value = parseJson(buffer);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const root = value as Record<string, unknown>;
  if (typeof root.type !== 'string' || !GEOJSON_TYPES.has(root.type)) {
    return false;
  }
  if (root.type === 'FeatureCollection') {
    return Array.isArray(root.features);
  }
  if (root.type === 'Feature') {
    return 'geometry' in root && 'properties' in root;
  }
  if (root.type === 'GeometryCollection') {
    return Array.isArray(root.geometries);
  }
  return Array.isArray(root.coordinates);
}

function isPlainText(buffer: Buffer): boolean {
  const text = decodeUtf8(buffer);
  return text !== undefined && !text.includes('\0');
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
}

const FORMATS: Readonly<Record<string, FileFormat>> = {
  '.docx': {
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    storageType: 'application',
    validate: isDocx,
  },
  '.glb': {
    mimeTypes: ['model/gltf-binary'],
    storageType: 'application',
    validate: isGlb,
  },
  '.mp4': { mimeTypes: ['video/mp4'], storageType: 'video', validate: isMp4 },
  '.png': {
    mimeTypes: ['image/png'],
    storageType: 'image',
    validate: (buffer) => startsWith(buffer, PNG_SIGNATURE),
  },
  '.jpg': { mimeTypes: ['image/jpeg'], storageType: 'image', validate: isJpeg },
  '.jpeg': { mimeTypes: ['image/jpeg'], storageType: 'image', validate: isJpeg },
  '.tif': { mimeTypes: ['image/tiff'], storageType: 'imageraster', validate: isTiff },
  '.tiff': { mimeTypes: ['image/tiff'], storageType: 'imageraster', validate: isTiff },
  '.json': {
    mimeTypes: ['application/json'],
    storageType: 'json',
    validate: isStructuredJson,
  },
  '.geojson': {
    mimeTypes: ['application/geo+json'],
    storageType: 'geojson',
    validate: isGeoJson,
  },
  '.srt': {
    mimeTypes: ['application/x-subrip', 'text/plain'],
    storageType: 'text',
    validate: isPlainText,
  },
  '.txt': { mimeTypes: ['text/plain'], storageType: 'text', validate: isPlainText },
  '.pdf': { mimeTypes: ['application/pdf'], storageType: 'application', validate: isPdf },
};

function decodeMulterFilename(name: string): string {
  if ([...name].some((character) => character.charCodeAt(0) > 0xff)) {
    return name;
  }
  const bytes = Buffer.from(name, 'latin1');
  const decoded = decodeUtf8(bytes);
  return decoded !== undefined && Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : name;
}

function normalizeSafeBasename(originalName: unknown): string {
  if (typeof originalName !== 'string' || originalName.length === 0) {
    throw new BadRequestException('A safe filename is required');
  }

  const fileName = decodeMulterFilename(originalName).normalize('NFC');
  if (
    fileName.length === 0 ||
    fileName !== fileName.trim() ||
    Buffer.byteLength(fileName, 'utf8') > 255 ||
    /[\u0000-\u001f\u007f]/.test(fileName) ||
    path.posix.basename(fileName) !== fileName ||
    path.win32.basename(fileName) !== fileName
  ) {
    throw new BadRequestException('Unsafe filename');
  }
  return fileName;
}

export function validateUpload(file: Express.Multer.File): ValidatedUpload {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException('A file is required');
  }
  if (file.buffer.length === 0 || file.buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new BadRequestException(`File size must be between 1 and ${MAX_UPLOAD_SIZE_BYTES} bytes`);
  }

  const fileName = normalizeSafeBasename(file.originalname);
  const extension = path.extname(fileName).toLowerCase();
  const format = FORMATS[extension];
  if (!format || !format.mimeTypes.includes(file.mimetype) || !format.validate(file.buffer)) {
    throw new BadRequestException('Unsupported file or mismatched filename, MIME, and content');
  }

  return {
    buffer: file.buffer,
    fileName,
    fingerprint: `sha256:${createHash('sha256').update(file.buffer).digest('hex')}`,
    mimeType: file.mimetype,
    size: file.buffer.length,
    storageType: format.storageType,
  };
}
