import { Injectable } from '@nestjs/common';
import * as Minio from 'minio';
import * as archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import { SaveMinioFile } from './dto/save_minio.dto';
import { ParamMinioFile } from './dto/param_minio.dto';

@Injectable()
export class MinioService {
  private readonly minioClient: Minio.Client;
  private readonly publicMinioClient: Minio.Client;
  private readonly bucketName: string;

  constructor() {
    const accessKey = process.env.MINIO_ACCESS_KEY || '';
    const secretKey = process.env.MINIO_SECRET_KEY || '';
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: false,
      accessKey,
      secretKey,
    });
    this.publicMinioClient = new Minio.Client({
      endPoint:
        process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: Number(process.env.MINIO_PUBLIC_PORT || process.env.MINIO_PORT || 9000),
      useSSL: false,
      accessKey,
      secretKey,
    });
    this.bucketName = process.env.MINIO_BUCKET || 'default';
  }

  private async ensureBucketExists() {
    const exists = await this.minioClient.bucketExists(this.bucketName).catch(() => false);
    if (!exists) {
      await this.minioClient.makeBucket(this.bucketName, '').catch(() => undefined);
    }
  }

  async uploadFile(body: SaveMinioFile, data: Buffer) {
    await this.ensureBucketExists();
    await this.minioClient.putObject(
      this.bucketName,
      `${body.folder}/${body.file_type}/${body.file_name}`,
      data,
    );
    return {
      bucket: this.bucketName,
      objectName: `${body.folder}/${body.file_type}/${body.file_name}`,
    };
  }

  async uploadFileByPath(objectName: string, filePath: string) {
    await this.ensureBucketExists();
    await this.minioClient.fPutObject(this.bucketName, objectName, filePath);
    return { bucket: this.bucketName, objectName };
  }

  async presignRead(objectName: string, expiresSeconds: number): Promise<string> {
    await this.ensureBucketExists();
    return this.publicMinioClient.presignedGetObject(
      this.bucketName,
      objectName,
      expiresSeconds,
    );
  }

  async openRead(objectName: string): Promise<Readable> {
    await this.ensureBucketExists();
    return this.minioClient.getObject(this.bucketName, objectName);
  }

  async putObject(objectName: string, bytes: Buffer, mediaType: string): Promise<void> {
    await this.ensureBucketExists();
    await this.minioClient.putObject(this.bucketName, objectName, bytes, bytes.byteLength, {
      'Content-Type': mediaType,
    });
  }

  async deleteFile(body: ParamMinioFile) {
    await this.ensureBucketExists();
    const objectName = `${body.folder}/${body.file_type}/${body.file_name}`;
    try {
      await this.minioClient.removeObject(this.bucketName, objectName);
      return { ok: true };
    } catch (err: any) {
      const code = err?.code || err?.Code;
      if (code === 'NoSuchKey' || code === 'NoSuchBucket') {
        return { ok: true, skipped: true };
      }
      throw err;
    }
  }

  async deleteFolder(bucketName: string, folderPath: string) {
    await this.ensureBucketExists();
    const stream = this.minioClient.listObjects(bucketName, folderPath, true);
    const objectsToDelete: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj) => objectsToDelete.push(obj.name));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
    });
    if (objectsToDelete.length > 0) {
      await this.minioClient.removeObjects(bucketName, objectsToDelete);
    }
    return { ok: true, count: objectsToDelete.length };
  }

  async read(objectName: string) {
    await this.ensureBucketExists();
    const stream = await this.minioClient.getObject(this.bucketName, objectName);
    const chunks: Buffer[] = [];
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(new Error(`Error reading file: ${err.message}`)));
    });
    try {
      return JSON.parse(buffer.toString('utf-8'));
    } catch {
      return buffer;
    }
  }

  async createZipFromTarget(target: string): Promise<{ zipStream: PassThrough; zipName: string }> {
    await this.ensureBucketExists();
    const zipStream = new PassThrough();
    const archive = archiver('zip');
    archive.pipe(zipStream);
    const objectsStream = this.minioClient.listObjectsV2(this.bucketName, target, true);
    for await (const obj of objectsStream as any) {
      if (obj.name.endsWith('/')) continue;
      const fileStream = await this.minioClient.getObject(this.bucketName, obj.name);
      archive.append(fileStream, {
        name: obj.name.replace(target, ''),
      });
    }
    await archive.finalize();
    return { zipStream, zipName: `${target.replace(/\//g, '_')}.zip` };
  }
}
