/**
 * Keeps the `next` dist-tag at or above `latest` for every package the release publishes.
 * `next` may hold a prerelease newer than `latest`, never anything older; a stable release moves
 * `latest` past a stale `next`, so this runs after every publish.
 *
 *   bun scripts/release/next-tag.ts [--published <version> --tag <dist-tag>] <package name>...
 */
export interface IDistTags {
  latest?: string;
  next?: string;
}

export interface IPublished {
  version: string;
  tag: string;
}

export interface IHealResult {
  moved: string[];
  failed: string[];
}

const newest = (opts: { versions: (string | undefined)[] }): string | undefined =>
  opts.versions.reduce<string | undefined>(
    (best, version) =>
      version !== undefined && (best === undefined || Bun.semver.order(version, best) > 0)
        ? version
        : best,
    undefined,
  );

/**
 * The version `next` must move to, or `undefined` when it need not. A version this run just published
 * counts on its tag at once: the registry can serve the old tags for minutes after a publish.
 */
export const planNextTag = (opts: {
  tags: IDistTags;
  published?: IPublished;
}): string | undefined => {
  const { tags, published } = opts;
  const latest = newest({
    versions: [tags.latest, published?.tag === 'latest' ? published.version : undefined],
  });
  const next = newest({
    versions: [tags.next, published?.tag === 'next' ? published.version : undefined],
  });

  if (latest === undefined) {
    return undefined;
  }

  return next === undefined || Bun.semver.order(next, latest) < 0 ? latest : undefined;
};

const messageOf = (opts: { error: unknown }): string =>
  opts.error instanceof Error ? opts.error.message : String(opts.error);

/** Never throws: a tag that cannot be moved is reported as a warning, and the release goes on. */
export const healNextTags = (opts: {
  packages: string[];
  published?: IPublished;
  read: (opts: { name: string }) => IDistTags;
  move: (opts: { name: string; version: string }) => void;
  log: (line: string) => void;
}): IHealResult => {
  const result: IHealResult = { moved: [], failed: [] };

  for (const name of opts.packages) {
    try {
      const tags = opts.read({ name });
      const version = planNextTag({ tags, published: opts.published });

      if (version === undefined) {
        opts.log(
          `next-tag: ${name} next ${tags.next ?? 'unset'} is at or above latest - unchanged`,
        );
        continue;
      }

      opts.move({ name, version });
      result.moved.push(name);
      opts.log(
        `::warning::next-tag: ${name} next was ${tags.next ?? 'unset'}, below latest ${version} - moved to ${version}`,
      );
    } catch (error) {
      result.failed.push(name);
      opts.log(
        `::warning::next-tag: ${name} next was NOT checked or moved - ${messageOf({ error })}`,
      );
    }
  }

  return result;
};

const NPM_ATTEMPTS = 3;

const runNpm = (opts: { args: string[] }): string => {
  const child = Bun.spawnSync(['npm', ...opts.args], { stdout: 'pipe', stderr: 'pipe' });

  if (child.exitCode !== 0) {
    throw new Error(`npm ${opts.args.join(' ')}: ${child.stderr.toString().trim()}`);
  }

  return child.stdout.toString();
};

const readFlag = (opts: { args: string[]; flag: string }): string | undefined => {
  const index = opts.args.indexOf(opts.flag);

  return index === -1 ? undefined : opts.args[index + 1];
};

const main = (): void => {
  const args = process.argv.slice(2);
  const version = readFlag({ args, flag: '--published' });
  const tag = readFlag({ args, flag: '--tag' });
  const flagValues = new Set([version, tag].filter(value => value !== undefined));
  const packages = args.filter(arg => !arg.startsWith('--') && !flagValues.has(arg));

  const result = healNextTags({
    packages,
    published: version === undefined || tag === undefined ? undefined : { version, tag },
    read: ({ name }) =>
      JSON.parse(runNpm({ args: ['view', name, 'dist-tags', '--json', '--prefer-online'] })),
    move: ({ name, version: target }) => {
      for (let attempt = 1; ; attempt++) {
        try {
          runNpm({ args: ['dist-tag', 'add', `${name}@${target}`, 'next'] });

          return;
        } catch (error) {
          if (attempt === NPM_ATTEMPTS) {
            throw error;
          }
        }
      }
    },
    log: line => console.log(line),
  });

  console.log(`next-tag: ${result.moved.length} moved, ${result.failed.length} failed`);
};

if (import.meta.main) {
  main();
}
