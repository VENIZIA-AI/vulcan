import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { AtlasConstants } from '@/common';
import { generateKeyPair, signEnvelope, verifyPair } from '@/prebuilt';
import type { IIndexPayload } from '@/prebuilt';

const INDEX = new TextEncoder().encode('an index, as bytes');

const payloadFor = (opts: { gz: Uint8Array }): IIndexPayload => ({
  format: AtlasConstants.INDEX_FORMAT,
  sha: 'a'.repeat(40),
  repo: 'acme/src',
  atlas: '0.4.6',
  builtAt: '2026-10-27T00:00:00.000Z',
  bytes: INDEX.length,
  digest: new Bun.CryptoHasher('sha256').update(opts.gz).digest('hex'),
  tags: '0123456789abcdef',
  history: true,
  releases: {
    releases: { kernel: [{ version: '1.0.0', date: '2026-01-01', sha: 'c'.repeat(40), order: 1 }] },
    changelogs: [],
  },
});

const GZ = gzipSync(INDEX);

const change = (opts: { text: string; edit: (envelope: Record<string, string>) => void }) => {
  const envelope = JSON.parse(opts.text) as Record<string, string>;

  opts.edit(envelope);

  return JSON.stringify(envelope);
};

const flipByte = (opts: { base64: string }): string => {
  const bytes = Buffer.from(opts.base64, 'base64');

  bytes[bytes.length - 3] ^= 0x01;

  return bytes.toString('base64');
};

describe('the signed envelope of a prebuilt index (C8)', () => {
  const pair = generateKeyPair();
  const payload = payloadFor({ gz: GZ });
  const envelope = signEnvelope({ payload, privateKey: pair.privateKey });

  test('a pair checks out with the key that signed it, and gives back the payload', () => {
    const checked = verifyPair({ envelope, gz: GZ, keys: [pair.publicKey] });

    expect(checked).toEqual({ ok: true, payload });
  });

  test('any one of several listed keys may be the signer', () => {
    const other = generateKeyPair();

    expect(verifyPair({ envelope, gz: GZ, keys: [other.publicKey, pair.publicKey] }).ok).toBe(true);
  });

  test('another key does not verify it, and neither does an empty list', () => {
    const other = generateKeyPair();

    expect(verifyPair({ envelope, gz: GZ, keys: [other.publicKey] })).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(verifyPair({ envelope, gz: GZ, keys: [] })).toEqual({ ok: false, reason: 'signature' });
  });

  test('a changed byte of the payload breaks the signature', () => {
    const tampered = change({
      text: envelope,
      edit: (parsed) => {
        parsed.payload = flipByte({ base64: parsed.payload });
      },
    });

    expect(verifyPair({ envelope: tampered, gz: GZ, keys: [pair.publicKey] })).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  test('a changed byte of the signature breaks it', () => {
    const tampered = change({
      text: envelope,
      edit: (parsed) => {
        parsed.signature = flipByte({ base64: parsed.signature });
      },
    });

    expect(verifyPair({ envelope: tampered, gz: GZ, keys: [pair.publicKey] })).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  test('a changed byte of the gz breaks the digest the payload signed', () => {
    const changed = Uint8Array.from(GZ);

    changed[changed.length - 12] ^= 0x01;
    expect(verifyPair({ envelope, gz: changed, keys: [pair.publicKey] })).toEqual({
      ok: false,
      reason: 'digest',
    });
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['an envelope with no signature', JSON.stringify({ payload: 'e30=' })],
    ['a signature of the wrong length', JSON.stringify({ payload: 'e30=', signature: 'AAAA' })],
  ])('%s is malformed, never a throw', (_label, text) => {
    expect(verifyPair({ envelope: text, gz: GZ, keys: [pair.publicKey] })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('a payload that is signed but is not the shape of one is malformed', () => {
    const bad = signEnvelope({
      payload: { ...payload, sha: 'not-a-sha' } as IIndexPayload,
      privateKey: pair.privateKey,
    });

    expect(verifyPair({ envelope: bad, gz: GZ, keys: [pair.publicKey] })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('a key list entry that is not a key is skipped, not thrown on', () => {
    expect(verifyPair({ envelope, gz: GZ, keys: ['@@not base64@@', pair.publicKey] }).ok).toBe(
      true,
    );
  });
});
