/** What a prebuilt index is called and where its key lives. */
export class PrebuiltConstants {
  /** The environment variable the signing key is read from: in CI an Actions secret of this name. */
  static readonly KEY_ENV = 'ATLAS_INDEX_KEY';
  /** Where `atlas index keygen` writes the private key: inside the project, gitignored. */
  static readonly KEY_FILE = '.agents/local/atlas-index.key';
  /** Where `atlas index` builds its scratch worktree. */
  static readonly SCRATCH_DIRECTORY = '.agents/local/tmp';
  /** `<sha>.atlas.gz`: the gzip of the commit's `index.sqlite`, and nothing else. */
  static readonly INDEX_SUFFIX = '.atlas.gz';
  /** `<sha>.atlas.json`: the signed envelope that describes the gz. */
  static readonly ENVELOPE_SUFFIX = '.atlas.json';
  static readonly PUBLIC_KEY_BYTES = 32;
  static readonly SIGNATURE_BYTES = 64;
  /** The fixed DER header of an ed25519 public key (SPKI), in front of its 32 raw bytes. */
  static readonly SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
}

/** Why a pair is not used. A closed list: the reader prints one of these and builds locally. */
export class MissReasons {
  static readonly MALFORMED = 'malformed';
  static readonly SIGNATURE = 'signature';
  static readonly DIGEST = 'digest';
}

export const pairNamesOf = (opts: { sha: string }): { gz: string; envelope: string } => ({
  gz: `${opts.sha}${PrebuiltConstants.INDEX_SUFFIX}`,
  envelope: `${opts.sha}${PrebuiltConstants.ENVELOPE_SUFFIX}`,
});
