-- AlterTable
ALTER TABLE "File"
ADD COLUMN     "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "fingerprint" TEXT;
