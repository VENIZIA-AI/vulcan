import { basename } from 'node:path';

/** How one program that can make a link reads its options. */
interface IMakerTable {
  /** The short options that take a value (the rest of the cluster, or the next word). */
  valued: string;
  /** Every long option: whether it takes its value as the next word. A unique prefix names one, as getopt reads it. */
  longs: Readonly<Record<string, boolean>>;
  /** The short options that matter here, by the key the long option of the same meaning has. */
  shorts: Readonly<Record<string, string>>;
  /** The key of the option that makes symbolic links. */
  symbolic: string;
  /** The key of the option that makes hard links; `ln` makes them unless told otherwise. */
  hard?: string;
}

/** What a program that makes links does with its words: where they point and the names they are made at. */
export interface ILinkMaker {
  /** What a hard link points at, as written: from the folder the command runs in. Empty for a symbolic link. */
  hardSources: string[];
  /** Every source word, hard or symbolic. */
  sources: string[];
  /** The names a symbolic link is made at, as candidates (the name may be a folder that exists); empty for a hard link. */
  names: string[];
  /** The name the links are made at, or the folder they are made in, as written. */
  destination: string | undefined;
}

const LN: IMakerTable = {
  valued: 'St',
  longs: {
    symbolic: false,
    relative: false,
    force: false,
    interactive: false,
    verbose: false,
    logical: false,
    physical: false,
    'no-dereference': false,
    'no-target-directory': false,
    'target-directory': true,
    suffix: true,
    backup: false,
    directory: false,
    help: false,
    version: false,
  },
  shorts: { s: 'symbolic' },
  symbolic: 'symbolic',
};

const CP: IMakerTable = {
  valued: 'St',
  longs: {
    'symbolic-link': false,
    link: false,
    archive: false,
    'attributes-only': false,
    backup: false,
    'copy-contents': false,
    'no-dereference': false,
    force: false,
    interactive: false,
    dereference: false,
    'no-clobber': false,
    'no-preserve': true,
    parents: false,
    preserve: false,
    recursive: false,
    reflink: false,
    'remove-destination': false,
    sparse: true,
    'strip-trailing-slashes': false,
    suffix: true,
    'target-directory': true,
    'no-target-directory': false,
    update: false,
    verbose: false,
    'one-file-system': false,
    context: false,
    debug: false,
    'keep-directory-symlink': false,
    help: false,
    version: false,
  },
  shorts: {
    s: 'symbolic-link',
    l: 'link',
    a: 'archive',
    P: 'no-dereference',
    d: 'no-dereference',
    r: 'recursive',
    R: 'recursive',
  },
  symbolic: 'symbolic-link',
  hard: 'link',
};

/** `mv` carries any link it moves; its options are only read to find the destination. */
const MV: IMakerTable = {
  valued: 'St',
  longs: {
    'target-directory': true,
    suffix: true,
    backup: false,
    force: false,
    interactive: false,
    'no-clobber': false,
    'no-target-directory': false,
    update: false,
    verbose: false,
    'strip-trailing-slashes': false,
    context: false,
    debug: false,
    help: false,
    version: false,
  },
  shorts: {},
  symbolic: '',
};

/** `rsync` copies a link as a link with `-l`, `-a` and `--links`; the options it takes a value for are read to find the destination. */
const RSYNC: IMakerTable = {
  valued: 'efBMT@',
  longs: { links: false, archive: false },
  shorts: { l: 'links', a: 'archive' },
  symbolic: '',
};

/** Coreutils `link FILE1 FILE2`: one hard link, with no options. */
const LINK: IMakerTable = { valued: '', longs: {}, shorts: {}, symbolic: 'symbolic' };

const CARRIERS: Readonly<Record<string, IMakerTable>> = { mv: MV, cp: CP, rsync: RSYNC };

const TABLES: Readonly<Record<string, IMakerTable>> = { ln: LN, cp: CP, link: LINK };

/** The options set, the other words and the target folder (`-t`, `--target-directory`) of a command line, read left to right. */
const read = (opts: {
  args: string[];
  table: IMakerTable;
}): { flags: Set<string>; words: string[]; directory: string | undefined } => {
  const { args, table } = opts;
  const flags = new Set<string>();
  const words: string[] = [];
  let directory: string | undefined;
  let isEnd = false;

  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';

    if (isEnd || !word.startsWith('-') || word === '-') {
      words.push(word);
      continue;
    }

    if (word === '--') {
      isEnd = true;
      continue;
    }

    if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      const name = word.slice(2, equals === -1 ? undefined : equals);
      const inline = equals === -1 ? undefined : word.slice(equals + 1);
      const keys = Object.hasOwn(table.longs, name)
        ? [name]
        : Object.keys(table.longs).filter((key) => key.startsWith(name));

      for (const key of keys) {
        flags.add(key);
      }

      const takesValue = keys.length > 0 && keys.every((key) => table.longs[key] === true);

      if (keys.length === 1 && keys[0] === 'target-directory') {
        directory = inline ?? args[index + 1];
      }

      if (takesValue && inline === undefined) {
        index += 1;
      }

      continue;
    }

    const letters = [...word.slice(1)];

    for (const [at, letter] of letters.entries()) {
      if (table.valued.includes(letter)) {
        const rest = letters.slice(at + 1).join('');

        if (letter === 't') {
          directory = rest === '' ? args[index + 1] : rest;
        }

        if (rest === '') {
          index += 1;
        }

        break;
      }

      const key = table.shorts[letter];

      if (key !== undefined) {
        flags.add(key);
      }
    }
  }

  return { flags, words, directory };
};

/** The folder `tar` extracts into, when it extracts (`tar xf a.tar -C dir`), as written. */
const tarDestination = (opts: { args: string[] }): string | undefined => {
  const first = opts.args[0] ?? '';
  const isExtract =
    (/^-?[a-zA-Z]+$/.test(first) && !first.startsWith('--') && first.includes('x')) ||
    opts.args.some((word) => word === '--extract' || word === '--get');

  if (!isExtract) {
    return undefined;
  }

  for (const [index, word] of opts.args.entries()) {
    if (word === '-C' || word === '--directory') {
      return opts.args[index + 1];
    }

    if (word.startsWith('--directory=')) {
      return word.slice('--directory='.length);
    }

    if (/^-[a-zA-Z]*C.+/.test(word)) {
      return word.slice(word.indexOf('C') + 1);
    }
  }

  return undefined;
};

export class LinkMakers {
  /**
   * The destination of a command that may carry a link the line made to a new name: `mv`, a `cp` that copies links (`-a`, `-P`,
   * `-d`, `-r`, `-R`), an `rsync` that does (`-l`, `-a`), a `tar` that extracts into a folder. The new name is one a later path
   * may go through, and the guard does not know whether the thing moved was a link, so the name counts as a link of the line.
   */
  static carriedTo(opts: { name: string; args: string[] }): string[] {
    if (opts.name === 'tar') {
      const destination = tarDestination({ args: opts.args });

      return destination === undefined ? [] : [destination];
    }

    const table = CARRIERS[opts.name];

    if (table === undefined) {
      return [];
    }

    const { flags, words, directory } = read({ args: opts.args, table });
    const isCarrying =
      opts.name === 'mv' ||
      (opts.name === 'cp' &&
        ['archive', 'no-dereference', 'recursive'].some((key) => flags.has(key))) ||
      (opts.name === 'rsync' && ['links', 'archive'].some((key) => flags.has(key)));
    const destination = directory ?? (words.length > 1 ? words.at(-1) : undefined);

    return isCarrying && destination !== undefined ? [destination] : [];
  }

  /**
   * What `ln` (and `cp -s`, `cp -l`) links, or `undefined` for a command that makes no link. A hard link keeps nothing of the
   * name it was given: the file is the same one, so what it points at is judged. A symbolic link keeps its text, which the
   * system reads from the link's own folder later, so what matters on the line is the names it is made at.
   */
  static of(opts: { name: string; args: string[] }): ILinkMaker | undefined {
    const table = TABLES[opts.name];

    if (table === undefined) {
      return undefined;
    }

    const { flags, words, directory } = read({ args: opts.args, table });
    const isSymbolic = flags.has(table.symbolic);
    const isHard = !isSymbolic && (table.hard === undefined || flags.has(table.hard));

    if (!isSymbolic && !isHard) {
      return undefined;
    }

    const link = directory === undefined && words.length > 1 ? words.at(-1) : undefined;
    const sources = directory !== undefined || link === undefined ? words : words.slice(0, -1);
    const named = (folder: string): string[] =>
      sources.map((source) => `${folder}${basename(source)}`);
    let names: string[] = [];

    if (isSymbolic) {
      if (directory !== undefined) {
        names = named(`${directory}/`);
      } else if (link === undefined) {
        names = named('');
      } else {
        names = link.endsWith('/') ? named(link) : [link, ...named(`${link}/`)];
      }
    }

    return {
      hardSources: isHard ? sources : [],
      sources,
      names: names.filter((name) => !/(?:^|\/)\.{1,2}$/.test(name)),
      destination: directory ?? link,
    };
  }
}
