import type { VulcanConfig } from '@venizia/vulcan';

export const knowledge = {
  bundle: '.agents/knowledge',
  wiki: 'docs/wiki/content',
  changelogs: 'docs/wiki/content/changelogs',
  // The changelog is one folder per version from 0.4.5 on: dated files are history (vulcan check changelog does not read them),
  // and none may be dated after datedUntil.
  migrationFrom: '0.4.5',
  datedUntil: '2026-11-14',
  codemodCommand: ['vulcan', 'config', 'codemod'],
  atlas: {
    // One tag per release train, named like IGNIS and ARDOR name theirs (`<name>-v<version>`), so one tag ruleset,
    // `*-v*`, covers all three repositories.
    tagPattern: 'vulcan-v<version>',
    legacyTagPatterns: ['v<version>'],
    // The public key of this repository's CI, which signs the atlas index it publishes (the atlas-index job of the workflow deploy-docs.yml);
    // the private key is the Actions secret ATLAS_INDEX_KEY and exists nowhere else.
    index: { keys: ['RO71nPFQIg09uea7CNjO1QwvEOtD85330LwiiD0cPSQ='] },
  },
} satisfies VulcanConfig.Knowledge;
