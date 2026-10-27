import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { PrebuiltConstants } from './constants';

export interface IIndexKeyPair {
  /** Base64 of the PKCS8 DER private key: the Actions secret. */
  privateKey: string;
  /** Base64 of the 32 raw bytes of the ed25519 public key: what the manifest lists. */
  publicKey: string;
}

export const generateKeyPair = (): IIndexKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });

  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: spki.subarray(spki.length - PrebuiltConstants.PUBLIC_KEY_BYTES).toString('base64'),
  };
};

/** A listed public key as a key object; `undefined` when the text is not 32 base64 bytes. */
export const publicKeyOf = (opts: { base64: string }): KeyObject | undefined => {
  const raw = Buffer.from(opts.base64, 'base64');

  if (raw.length !== PrebuiltConstants.PUBLIC_KEY_BYTES) {
    return undefined;
  }

  try {
    return createPublicKey({
      key: Buffer.concat([PrebuiltConstants.SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return undefined;
  }
};

export const privateKeyOf = (opts: { base64: string }): KeyObject =>
  createPrivateKey({
    key: Buffer.from(opts.base64.trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
