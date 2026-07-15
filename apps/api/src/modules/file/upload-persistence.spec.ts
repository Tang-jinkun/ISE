import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('File upload persistence schema', () => {
  it('defines the additive MIME and fingerprint fields expected by Wave 1', () => {
    const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');

    expect(schema).toMatch(/mimeType\s+String\s+@default\("application\/octet-stream"\)/);
    expect(schema).toMatch(/fingerprint\s+String\?/);
  });

  it('migrates existing File rows without requiring backfill data', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../prisma/migrations/20260715000000_add_file_upload_metadata/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'ADD COLUMN     "mimeType" TEXT NOT NULL DEFAULT \'application/octet-stream\'',
    );
    expect(migration).toContain('ADD COLUMN     "fingerprint" TEXT');
  });
});
