import { createHash } from 'node:crypto';
import { GraphConstants } from './common/constants';

export class GraphHash {
  /** A short sha-256 of text or bytes. */
  static of(opts: { data: string | Uint8Array }): string {
    return createHash('sha256')
      .update(opts.data)
      .digest('hex')
      .slice(0, GraphConstants.HASH_LENGTH);
  }
}
