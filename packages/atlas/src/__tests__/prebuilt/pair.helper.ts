import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildIndexPair, generateKeyPair, signEnvelope } from '@/prebuilt';
import type { IIndexKeyPair, IIndexPayload } from '@/prebuilt';
import { makeSourceRepository } from '../sources/source-repo.helper';

export interface IFixturePair {
  sha: string;
  gz: Uint8Array;
  envelope: string;
  keys: IIndexKeyPair;
  payload: IIndexPayload;
}

/** The payload an envelope carries, read back (a test reads it; the reader verifies it). */
export const payloadOf = (opts: { envelope: string }): IIndexPayload =>
  JSON.parse(
    Buffer.from((JSON.parse(opts.envelope) as { payload: string }).payload, 'base64').toString(
      'utf8',
    ),
  ) as IIndexPayload;

/** A pair for the commit of a source repository, built the way CI builds it, signed with a fresh key. */
export const makeFixturePair = (
  opts: { repo?: string; keys?: IIndexKeyPair; work?: string } = {},
): IFixturePair => {
  const work = opts.work ?? makeSourceRepository().work;
  const keys = opts.keys ?? generateKeyPair();
  const out = join(work, '.agents/local/tmp/pair');
  const built = buildIndexPair({
    root: work,
    out,
    repo: opts.repo ?? 'acme/src',
    privateKey: keys.privateKey,
    atlasVersion: '9.9.9',
  });
  const envelope = readFileSync(built.envelope, 'utf8');

  return {
    sha: built.sha,
    gz: readFileSync(built.gz),
    envelope,
    keys,
    payload: payloadOf({ envelope }),
  };
};

/** The same pair with another index inside: a signed, consistent set whose index is whatever the test makes. */
export const withIndex = (opts: {
  pair: IFixturePair;
  index: Uint8Array;
  edit?: (payload: IIndexPayload) => void;
}) => {
  const gz = gzipSync(opts.index);
  const payload: IIndexPayload = {
    ...opts.pair.payload,
    bytes: opts.index.length,
    digest: new Bun.CryptoHasher('sha256').update(gz).digest('hex'),
  };

  opts.edit?.(payload);

  return { gz, envelope: signEnvelope({ payload, privateKey: opts.pair.keys.privateKey }) };
};

/** The pair's envelope with a change to its payload, signed again by the same key. */
export const resigned = (opts: {
  pair: IFixturePair;
  edit: (payload: IIndexPayload) => void;
}): string => {
  const payload = { ...opts.pair.payload };

  opts.edit(payload);

  return signEnvelope({ payload, privateKey: opts.pair.keys.privateKey });
};

/** The ten stored columns of every chunk, in the order the table holds them. */
export const rowsOf = (opts: { bytes: Uint8Array }): unknown[] => {
  const database = Database.deserialize(opts.bytes);
  const rows = database
    .query(
      `SELECT id, corpus, document, anchor, heading_path, title, body, symbols, metadata, authority
       FROM chunks ORDER BY rowid`,
    )
    .all();

  database.close();

  return rows;
};
