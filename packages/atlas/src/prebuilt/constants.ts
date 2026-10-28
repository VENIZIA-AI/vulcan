/** What a prebuilt index is called, where its key lives, and how much of it a reader will take. */
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
  /** The one release of a repository that holds its pairs. */
  static readonly RELEASE_TAG = 'atlas-index';
  static readonly PUBLIC_KEY_BYTES = 32;
  static readonly SIGNATURE_BYTES = 64;
  /** The fixed DER header of an ed25519 public key (SPKI), in front of its 32 raw bytes. */
  static readonly SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  /** An envelope is a few hundred KB at most (it carries the release table). */
  static readonly MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;
  /** A gz larger than this is refused unread; a documentation index of a large repository is a few MB gzipped. */
  static readonly MAX_GZ_BYTES = 128 * 1024 * 1024;
  /** A payload that announces a larger index than this is refused before the gz is downloaded. */
  static readonly MAX_INDEX_BYTES = 512 * 1024 * 1024;
  static readonly ASSETS_PER_PAGE = 100;
  /** Pages of release assets read before the pair counts as absent (2000 assets, twice the cap of GitHub). */
  static readonly MAX_ASSET_PAGES = 20;
  static readonly MAX_REDIRECTS = 3;
}

/** Why a pair is not used. A closed list: the reader prints one of these and builds locally. */
export class MissReasons {
  static readonly MALFORMED = 'malformed';
  static readonly SIGNATURE = 'signature';
  static readonly DIGEST = 'digest';
  static readonly SHA = 'sha';
  static readonly REPO = 'repo';
  static readonly FORMAT = 'format';
  static readonly TOO_LARGE = 'too-large';
  static readonly SIZE = 'size';
  static readonly UNREADABLE = 'unreadable';
  static readonly NO_RELEASE = 'no-release';
  static readonly NO_PAIR = 'no-pair';
  static readonly UNREACHABLE = 'unreachable';
  static readonly FOREIGN_URL = 'foreign-url';
}

export const pairNamesOf = (opts: { sha: string }): { gz: string; envelope: string } => ({
  gz: `${opts.sha}${PrebuiltConstants.INDEX_SUFFIX}`,
  envelope: `${opts.sha}${PrebuiltConstants.ENVELOPE_SUFFIX}`,
});

/** How a repository publishes its pairs, and how many it keeps. */
export class PublishConstants {
  /** Besides the default branch, the branch whose head every project publishes. */
  static readonly DEVELOP_BRANCH = 'develop';
  static readonly RELEASE_NAME = 'atlas index';
  static readonly RELEASE_NOTES =
    'The signed atlas index of each commit of this repository, read by atlas. Maintained by CI; do not edit.';
  /** The newest branch-head pairs kept. */
  static readonly KEEP_HEADS = 20;
  /** Pairs kept in all: a release has 1000 assets at most, two to a pair. */
  static readonly MAX_PAIRS = 300;
  /** A pair with one asset missing is left alone for this long (a run may be uploading it), then removed. */
  static readonly ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
  static readonly SCRATCH_OUT = '.agents/local/tmp/atlas-index-out';
  /** What a ref given to a manual run may look like: a plain tag or branch name, never an option or a revision expression. */
  static readonly REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
  /** A name that reads as a commit hash is a hash, not a tag or a branch: refused. */
  static readonly HASH_LIKE = /^[0-9a-f]{7,40}$/i;
}
