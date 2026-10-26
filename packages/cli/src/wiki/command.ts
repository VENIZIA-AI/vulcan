import { existsSync } from 'node:fs';
import { ExitCodes } from '../common/index.ts';
import { checkAnchors } from './anchors.ts';
import { WikiDefaults, WikiFlags } from './constants.ts';
import { checkSourceLinks } from './source-links.ts';

/** The value after `--flag`, or the fallback; `undefined` when the flag has no value after it. */
const valueOf = (opts: { args: string[]; flag: string; fallback?: string }): string | undefined => {
  const at = opts.args.indexOf(opts.flag);

  if (at === -1) {
    return opts.fallback;
  }

  const value = opts.args[at + 1];

  return value === undefined || value.startsWith('--') ? undefined : value;
};

const listOf = (opts: { value: string }): string[] =>
  opts.value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

/**
 * `wiki-source-links --repo <owner/name>`: every source path the wiki names is tracked by git. Run from the
 * repository root; the other flags replace the defaults (comma-separated lists).
 */
export const runSourceLinksCommand = (opts: { args: string[]; root: string }): number => {
  const { args } = opts;
  const repo = valueOf({ args, flag: WikiFlags.REPO });
  const directories = valueOf({
    args,
    flag: WikiFlags.DIRS,
    fallback: `${WikiDefaults.CONTENT_DIRECTORY},${WikiDefaults.KNOWLEDGE_DIRECTORY}`,
  });
  const skipProse = valueOf({
    args,
    flag: WikiFlags.SKIP_PROSE,
    fallback: WikiDefaults.CHANGELOG_DIRECTORY,
  });
  const skip = valueOf({ args, flag: WikiFlags.SKIP, fallback: '' });

  if (repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error(
      `wiki-source-links: ${WikiFlags.REPO} <owner/name> is required, for example ${WikiFlags.REPO} VENIZIA-AI/vulcan`,
    );

    return ExitCodes.FAILURE;
  }

  if (directories === undefined || skipProse === undefined || skip === undefined) {
    console.error('wiki-source-links: a flag has no value after it');

    return ExitCodes.FAILURE;
  }

  const { checked, missing } = checkSourceLinks({
    root: opts.root,
    repo,
    directories: listOf({ value: directories }),
    skipProseUnder: listOf({ value: skipProse }),
    skipFiles: listOf({ value: skip }),
  });

  for (const miss of missing) {
    console.log(`${miss.file}:${miss.line} ${miss.path}`);
  }

  console.log(`wiki-source-links: ${checked} paths checked, ${missing.length} missing`);

  return missing.length > 0 ? ExitCodes.FAILURE : ExitCodes.OK;
};

/** `wiki-anchors`: every in-page anchor the wiki links to exists in the built site. Needs a build. */
export const runAnchorsCommand = (opts: { args: string[]; root: string }): number => {
  const content = valueOf({
    args: opts.args,
    flag: WikiFlags.CONTENT,
    fallback: WikiDefaults.CONTENT_DIRECTORY,
  });
  const dist = valueOf({
    args: opts.args,
    flag: WikiFlags.DIST,
    fallback: WikiDefaults.DIST_DIRECTORY,
  });

  if (content === undefined || dist === undefined) {
    console.error('wiki-anchors: a flag has no value after it');

    return ExitCodes.FAILURE;
  }

  if (!existsSync(dist)) {
    console.log('wiki-anchors: no build found - run `make docs` first');

    return ExitCodes.FAILURE;
  }

  const { checked, broken } = checkAnchors({ content, dist });

  for (const entry of broken) {
    console.log(`${entry.file}:${entry.line} ${entry.reason}: ${entry.target}`);
  }

  console.log(`wiki-anchors: ${checked} anchors checked, ${broken.length} broken`);

  return broken.length > 0 ? ExitCodes.FAILURE : ExitCodes.OK;
};
