import { createHash, sign, verify } from 'node:crypto';
import { z } from 'zod';
import type { IReleaseTable } from '@/releases/common';
import { MissReasons, PrebuiltConstants } from './constants';
import { privateKeyOf, publicKeyOf } from './keys';

/** What a pair says about itself. Signed as the exact bytes it is serialised to, never re-encoded. */
export interface IIndexPayload {
  /** `AtlasConstants.INDEX_FORMAT` of the atlas that built the index. */
  format: number;
  /** The commit the index was built from. */
  sha: string;
  /** `owner/name`, lowercase: a pair is never valid for another repository. */
  repo: string;
  /** The atlas version that built it; informational. */
  atlas: string;
  /** When it was built; informational. */
  builtAt: string;
  /** The size of the decompressed index. */
  bytes: number;
  /** sha256 of the gz, hex. */
  digest: string;
  /** The fingerprint of the repository's tags when it was built (what `lsRemote` computes). */
  tags: string;
  history: boolean;
  releases: IReleaseTable;
}

const PayloadSchema = z
  .object({
    format: z.number().int().positive(),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    atlas: z.string().min(1),
    builtAt: z.string().min(1),
    bytes: z.number().int().positive(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    tags: z.string(),
    history: z.boolean(),
    releases: z
      .object({
        releases: z.record(z.string(), z.array(z.object({}).passthrough())),
        changelogs: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .strict();

const EnvelopeSchema = z.object({ payload: z.string(), signature: z.string() }).strict();

export type TPairCheck = { ok: true; payload: IIndexPayload } | { ok: false; reason: string };

/** The envelope's text: the payload as base64 of the bytes signed, and the ed25519 signature over them. */
export const signEnvelope = (opts: { payload: IIndexPayload; privateKey: string }): string => {
  const bytes = Buffer.from(JSON.stringify(opts.payload));
  const signature = sign(null, bytes, privateKeyOf({ base64: opts.privateKey }));

  return `${JSON.stringify({ payload: bytes.toString('base64'), signature: signature.toString('base64') })}\n`;
};

const miss = (opts: { reason: string }): TPairCheck => ({ ok: false, reason: opts.reason });

/**
 * A pair is usable only when a listed key verifies the signature over the payload bytes, the payload
 * has the shape of one, and the gz is the one the payload names. What the payload says about the
 * commit, the repository and the format is the reader's to compare.
 */
export const verifyPair = (opts: {
  envelope: string;
  gz: Uint8Array;
  keys: string[];
}): TPairCheck => {
  let text: unknown;

  try {
    text = JSON.parse(opts.envelope);
  } catch {
    return miss({ reason: MissReasons.MALFORMED });
  }

  const parsed = EnvelopeSchema.safeParse(text);

  if (!parsed.success) {
    return miss({ reason: MissReasons.MALFORMED });
  }

  const payloadBytes = Buffer.from(parsed.data.payload, 'base64');
  const signature = Buffer.from(parsed.data.signature, 'base64');

  if (signature.length !== PrebuiltConstants.SIGNATURE_BYTES) {
    return miss({ reason: MissReasons.MALFORMED });
  }

  const signed = opts.keys.some((base64) => {
    const key = publicKeyOf({ base64 });

    return key !== undefined && verify(null, payloadBytes, key, signature);
  });

  if (!signed) {
    return miss({ reason: MissReasons.SIGNATURE });
  }

  let payload: z.SafeParseReturnType<unknown, unknown>;

  try {
    payload = PayloadSchema.safeParse(JSON.parse(payloadBytes.toString('utf8')));
  } catch {
    return miss({ reason: MissReasons.MALFORMED });
  }

  if (!payload.success) {
    return miss({ reason: MissReasons.MALFORMED });
  }

  const checked = payload.data as IIndexPayload;

  if (createHash('sha256').update(opts.gz).digest('hex') !== checked.digest) {
    return miss({ reason: MissReasons.DIGEST });
  }

  return { ok: true, payload: checked };
};
