import { agentError } from '../api/errors.ts'
import type { NestGateway } from '../adapters/nestGateway.ts'

export interface AttachmentReader {
  readVerified(fileId: string): Promise<Buffer>
}

export interface StoredAttachment {
  fileId: string
  name: string
  mimeType: string
  size: number
  fingerprint: string
}

export interface SessionAttachmentLookup {
  get(sessionId: string, fileId: string): StoredAttachment | undefined
}

export class SessionAttachmentReader implements AttachmentReader {
  constructor(
    readonly sessionId: string,
    readonly authorization: string,
    readonly attachments: SessionAttachmentLookup,
    readonly nest: NestGateway,
  ) {}

  async readVerified(fileId: string): Promise<Buffer> {
    const stored = this.attachments.get(this.sessionId, fileId)
    if (!stored) throw agentError(404, 'ATTACHMENT_NOT_FOUND')
    const remote = await this.nest.readOwnedFile(fileId, this.authorization)
    if (
      remote.name !== stored.name
      || remote.mimeType !== stored.mimeType
      || remote.size !== stored.size
      || remote.fingerprint !== stored.fingerprint
    ) {
      throw agentError(415, 'ATTACHMENT_IDENTITY_CHANGED')
    }
    return Buffer.from(remote.bytes)
  }
}
