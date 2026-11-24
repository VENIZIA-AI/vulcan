import { z } from 'zod';
import { TemplatePlaceholders } from '../../common/index.ts';
import { AtlasSectionConstants } from './constant.ts';

/** An ed25519 public key as `atlas index keygen` prints it: the base64 of its 32 raw bytes, nothing else. */
const INDEX_PUBLIC_KEY = z.string().refine(
  (value) => {
    const raw = Buffer.from(value, 'base64');

    return raw.length === 32 && raw.toString('base64') === value;
  },
  { message: 'the public key `atlas index keygen` prints: the base64 of 32 bytes' },
);

/**
 * A release template: `<dir>` is the package DIRECTORY - the `packages` key,
 * never the npm name (`packages/core-server` published as `@acme/server` tags `core-server-v1.2.0`); `<version>` is the
 * version; `<issue>` an issue number. Every other character is literal. When matching a commit, a
 * leading `[#<issue>] ` is optional and a trailing ` [<mode>]` is tolerated. A release train that
 * tags once leaves `<dir>` out (`v<version>`).
 */
const RELEASE_TEMPLATE = z
  .string()
  .refine((value) => value.includes('<version>'), {
    message: 'a template with <version> (and <dir> for per-package releases)',
  })
  .superRefine((value, context) => {
    const unknown = TemplatePlaceholders.unknownIn({ template: value });

    if (unknown.length > 0) {
      context.addIssue({
        code: 'custom',
        message: TemplatePlaceholders.problemOf({ unknown }),
      });
    }
  });

export const ATLAS_SECTION = {
  /** Settings of atlas: release tag layout, the sources it indexes, ignored tags, the signing keys of the published index and prebuilt downloads. */
  atlas: z
    .strictObject({
      /** Template of a release tag; must hold `<version>`, and `<dir>` for per-package tags. Default `<dir>-v<version>`. */
      tagPattern: RELEASE_TEMPLATE.default('<dir>-v<version>'),
      /**
       * Templates of an earlier tag layout that are still releases: atlas and the changelog check read a tag
       * through `tagPattern` first and then through each of these, so a rename of the tags keeps the old
       * releases. Unlike `ignoreTags`, a tag matched here counts as a release.
       */
      legacyTagPatterns: z.array(RELEASE_TEMPLATE).optional(),
      /** Repositories atlas indexes besides this one, each with a `name`, a `repo` and a `ref`; default `[]`. */
      sources: z
        .array(
          z
            .strictObject({
              /** Identifier of the source in atlas results: letters, digits, `_`, `.` and `-`, starting with a letter or a digit. */
              name: z
                .string()
                .regex(
                  /^[A-Za-z0-9][\w.-]*$/,
                  'a name of letters, digits, _ . and -, starting with a letter or a digit',
                ),
              /** GitHub repository of the source, as `owner/repo`. */
              repo: z.string().refine((value) => !value.trimStart().startsWith('-'), {
                message: "a repository, not an option: it must not start with '-'",
              }),
              /** Branch, tag or commit the source is indexed at; default `develop`. */
              ref: z
                .string()
                .refine((value) => !value.trimStart().startsWith('-'), {
                  message: "a ref, not an option: it must not start with '-'",
                })
                .default('develop'),
              /** `installed` (default): the docs are read at the tag of the newest installed package; `ref`: at `ref`. */
              pin: z.enum(['installed', 'ref']).optional(),
            })
            .superRefine((source, context) => {
              const refused = AtlasSectionConstants.SOURCE_TRANSPORT.exec(source.repo.trim());

              if (refused !== null) {
                context.addIssue({
                  code: 'custom',
                  path: ['repo'],
                  message: `source '${source.name}': the repository uses ${refused[1] === undefined ? 'a remote-helper URL, which runs a command' : `${refused[1].toLowerCase()}://, which is clear text`} - use https or ssh`,
                });
              }
            }),
        )
        .default([]),
      /** Tags neither read nor checked (globs) - an old layout's tags. */
      ignoreTags: z.array(z.string()).optional(),
      /**
       * The prebuilt atlas index this repository publishes: the public keys (any one may have signed a
       * pair) that a project reading this one as a source checks the signature against. Rotation is a
       * new list; a pair signed by a key no longer listed is not used.
       */
      index: z.strictObject({ keys: z.array(INDEX_PUBLIC_KEY).default([]) }).optional(),
      /** `false`: atlas never downloads a prebuilt index for a source this project reads; the default is to. */
      prebuilt: z.boolean().optional(),
      /** The sizes atlas holds to when it fetches. */
      limits: z
        .strictObject({
          /**
           * The most bytes atlas reads of one tarball it downloads (a source's commit from GitHub, an npm package
           * for its declarations); a larger one is refused and nothing is kept. An integer from 1 MiB to 1 GiB;
           * default 128 MiB.
           */
          download: z
            .number()
            .int()
            .min(AtlasSectionConstants.MIN_DOWNLOAD_BYTES)
            .max(AtlasSectionConstants.MAX_DOWNLOAD_BYTES)
            .optional(),
        })
        .optional(),
    })
    .default({
      tagPattern: '<dir>-v<version>',
      sources: [],
    }),
};
