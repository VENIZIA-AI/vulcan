/** How one subcommand of `git` or `gh` may be written for its arguments to stay data: nothing in these runs or writes. */
interface ICommandForm {
  /** Options that stand alone. */
  flags?: readonly string[];
  /** Options whose value is the next word. */
  valued?: readonly string[];
  /** Options written with their value (`--grep=x`), up to and with the `=`. */
  prefixes?: readonly string[];
}

const HISTORY: ICommandForm = {
  flags: [
    '--all',
    '--cached',
    '--graph',
    '--merges',
    '--name-only',
    '--name-status',
    '--no-merges',
    '--oneline',
    '--quiet',
    '--reverse',
    '--short',
    '--staged',
    '--stat',
    '-p',
    '-q',
  ],
  valued: ['--author', '--grep', '--since', '-S', '-n'],
  prefixes: ['--author=', '--format=', '--grep=', '--pretty=', '--since='],
};

const GIT_FORMS: ReadonlyMap<string, ICommandForm> = new Map([
  ['add', { flags: ['--all', '--update', '-A', '-p', '-u'] }],
  ['branch', { flags: ['--show-current', '-a', '-r', '-v', '-vv'] }],
  ['checkout', { flags: ['--quiet', '-b', '-q'] }],
  [
    'commit',
    {
      flags: ['--all', '--allow-empty', '--amend', '--no-edit', '--quiet', '-a', '-q', '-s'],
      valued: ['--file', '--message', '-C', '-F', '-am', '-c', '-m', '-qm'],
      prefixes: ['--file=', '--message='],
    },
  ],
  ['diff', HISTORY],
  ['fetch', { flags: ['--prune', '--quiet', '--tags', '-p', '-q'] }],
  [
    'grep',
    {
      flags: [
        '--cached',
        '--untracked',
        '-E',
        '-F',
        '-I',
        '-P',
        '-c',
        '-i',
        '-l',
        '-n',
        '-r',
        '-w',
      ],
      valued: ['-A', '-B', '-C', '-e'],
    },
  ],
  ['log', HISTORY],
  ['merge-base', { flags: ['--is-ancestor'] }],
  ['pull', { flags: ['--ff-only', '--quiet', '--rebase', '-q'] }],
  ['push', { flags: ['--quiet', '--set-upstream', '--tags', '-q', '-qu', '-u'] }],
  ['rev-parse', { flags: ['--abbrev-ref', '--short'] }],
  ['show', HISTORY],
  [
    'status',
    {
      flags: [
        '--branch',
        '--porcelain',
        '--short',
        '--untracked-files=all',
        '-b',
        '-q',
        '-s',
        '-sb',
        '-uall',
      ],
    },
  ],
  ['switch', { flags: ['--create', '--quiet', '-c', '-q', '-qc'] }],
]);

const GH_TEXT: ICommandForm = {
  flags: ['--draft', '--latest', '--prerelease', '-d'],
  valued: [
    '--assignee',
    '--base',
    '--body',
    '--body-file',
    '--head',
    '--jq',
    '--json',
    '--label',
    '--milestone',
    '--notes',
    '--notes-file',
    '--target',
    '--project',
    '--repo',
    '--title',
    '-B',
    '-F',
    '-H',
    '-R',
    '-b',
    '-l',
    '-n',
    '-t',
  ],
  prefixes: ['--body=', '--notes=', '--title='],
};

const GH_GROUPS = new Set(['issue', 'pr', 'release']);
const GH_ACTIONS = new Set(['checks', 'comment', 'create', 'edit', 'list', 'ready', 'view']);

/** Reading programs with no option that runs a program or writes a file. */
const PURE = new Set([
  'cat',
  'cd',
  'cut',
  'diff',
  'echo',
  'egrep',
  'fgrep',
  'grep',
  'head',
  'ls',
  'printf',
  'stat',
  'tail',
  'tr',
  'true',
  'wc',
  'which',
]);

/** Reading programs that are data only with these arguments and no other: another one can write. */
const ONLY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['sort', new Set(['-n', '-r', '-u'])],
  ['uniq', new Set(['-c', '-d', '-u'])],
]);

/** The commands whose arguments can stay data, each with the arguments it may take. Everything else is checked. */
export class CommandForms {
  /** Whether a command named `program` with `args` can neither run nor write what it is given. */
  static isPlain(opts: { program: string; args: readonly string[] }): boolean {
    const { program, args } = opts;
    const only = ONLY.get(program);

    if (PURE.has(program)) {
      return true;
    }

    if (only !== undefined) {
      return args.every((word) => only.has(word));
    }

    // Its options that run a program are long ones.
    if (program === 'rg') {
      return args.every((word) => !word.startsWith('--'));
    }

    if (program === 'git') {
      const at = args[0] === '-C' ? 2 : 0;
      const form = GIT_FORMS.get(args[at] ?? '');

      return form !== undefined && CommandForms.follows({ form, args: args.slice(at + 1) });
    }

    if (program === 'gh') {
      return (
        GH_GROUPS.has(args[0] ?? '') &&
        GH_ACTIONS.has(args[1] ?? '') &&
        CommandForms.follows({ form: GH_TEXT, args: args.slice(2) })
      );
    }

    return false;
  }

  /** Whether every option is one of the form's, written in full; the other words are operands. */
  private static follows(opts: { form: ICommandForm; args: readonly string[] }): boolean {
    const { form, args } = opts;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';

      if (word === '--') {
        return true;
      }

      if (form.valued?.includes(word) === true) {
        index += 1;
        continue;
      }

      const isOption = word.startsWith('-') && !/^-n?\d+$/.test(word);
      const isKnown =
        form.flags?.includes(word) === true ||
        form.prefixes?.some((prefix) => word.startsWith(prefix)) === true;

      if (isOption && !isKnown) {
        return false;
      }
    }

    return true;
  }
}
