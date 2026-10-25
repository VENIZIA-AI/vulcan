import { HookConstants } from './common/index.ts';
import type { IWriteHit } from './common/index.ts';
import { forHost } from './decision.ts';
import { optionTakesNextWord, programOf } from './shell.ts';

// -----------------------------------------------------------------------------
// The remote-host guard: a Bash command that reaches a host the project has not listed asks first.
//
// Hosts are read from the command, then compared whole: exact name, or a pattern whose only wildcard is `*`
// (it stays inside host characters). A name is never searched for inside the command text, a user, a path
// or an argument - that substring match is how a trusted name once let another host through. What the guard
// cannot read (a substitution, a jump through a command, an unknown client) asks.
// -----------------------------------------------------------------------------

export interface IRemoteHostsPolicy {
  /** Hosts any command may reach. */
  trusted: string[];
  /** Hosts that only the strict read-only forms may reach. */
  readOnly: string[];
  /** Where the personal trusted list lives, for the message. */
  localFile?: string;
}

interface ISegment {
  words: string[];
  /** `$(...)` or a backtick ran inside it: what it reaches is decided at run time. */
  substitution: boolean;
  /** A `<` or `>` redirect: the form is not a bare read. */
  redirect: boolean;
}

interface IFinding {
  hosts: string[];
  /** Why the target cannot be read; `undefined` when every host is known. */
  unreadable?: string;
  /** The whole form is one of the strict read-only forms. */
  strict: boolean;
  redirect: boolean;
  /** The target is not a remote login: only a host the project listed matters, any other is left alone. */
  listedOnly?: boolean;
  /** The target is the current ambient one (a kubeconfig context): read on a host, it is that host's own. */
  ambient?: boolean;
  /** An ssh's remote command: it runs on the far side, and may hop on. */
  remote?: string[];
}

// --- host matching ---

const WILDCARD = '*';
const PATTERN_CHARACTERS = /^[a-z0-9._*-]+$/;

/** `${VAR}` as `$VAR`: the same unexpanded token. */
const normalizeVariable = (opts: { host: string }): string =>
  opts.host.replace(/^\$\{(\w+)\}$/, '$$$1');

/** Whether `host` is one of `entries`: whole-name equal, or a `*` pattern. Case-insensitive. */
export const matchesHost = (opts: { host: string; entries: string[] }): boolean => {
  const host = normalizeVariable({ host: opts.host.toLowerCase() });

  return opts.entries.some((entry) => {
    const wanted = normalizeVariable({ host: entry.toLowerCase() });

    if (!wanted.includes(WILDCARD)) {
      return host === wanted;
    }

    if (
      !PATTERN_CHARACTERS.test(wanted) ||
      wanted.replaceAll(WILDCARD, '').replaceAll('.', '') === ''
    ) {
      return false;
    }

    const pattern = wanted
      .split(WILDCARD)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
      .join('[a-z0-9._-]*');

    return new RegExp(`^${pattern}$`).test(host);
  });
};

/** The personal trusted list: one host per line, `#` starts a comment. */
export const parseTrustedList = (opts: { text: string }): string[] =>
  opts.text
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line !== '');

// --- reading a command ---

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);
const REDIRECTS = new Set(['<', '>']);

/** Shell words, split into the commands they form. Quotes are removed; a `#` word starts a comment. */
const tokenize = (opts: { command: string }): ISegment[] => {
  const segments: ISegment[] = [];
  let words: string[] = [];
  let current = '';
  let started = false;
  let quote: string | undefined;
  let substitution = false;
  let redirect = false;
  const text = opts.command;

  const endWord = (): void => {
    if (started) {
      words.push(current);
    }

    current = '';
    started = false;
  };

  const endSegment = (): void => {
    endWord();

    if (words.length > 0) {
      segments.push({ words, substitution, redirect });
    }

    words = [];
    substitution = false;
    redirect = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      } else {
        current += char;
      }

      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else if (char === '\\' && next !== undefined && '"\\$`'.includes(next)) {
        current += next;
        index++;
      } else {
        substitution ||= char === '`' || (char === '$' && next === '(');
        current += char;
      }

      continue;
    }

    if (char === '\\' && next !== undefined) {
      if (next !== '\n') {
        current += next;
        started = true;
      }

      index++;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '`' || (char === '$' && next === '(')) {
      substitution = true;
      current += char;
      started = true;
    } else if (char === '#' && !started) {
      while (index < text.length && text[index] !== '\n') {
        index++;
      }

      endSegment();
    } else if (char === ' ' || char === '\t' || char === '\r') {
      endWord();
    } else if (SEPARATORS.has(char)) {
      endSegment();
    } else if (REDIRECTS.has(char)) {
      redirect = true;
      endWord();

      // Input from a file or a string is kept as a word, so a shell fed that way is seen reading it.
      if (char === '<') {
        words.push(char);
      }
    } else {
      current += char;
      started = true;
    }
  }

  endSegment();

  return segments;
};

const basenameOf = (opts: { word: string }): string =>
  (opts.word.split('/').pop() ?? opts.word).toLowerCase();

/** The host of `[user@]host`, `ssh://user@host:port/` or `[v6]`; lowercase, no user, no port in a URL. */
const hostOf = (opts: { value: string }): string => {
  const url = /^(?:ssh|scp|sftp|rsync):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:]+)/i.exec(opts.value);
  const bare = url?.[1] ?? opts.value.slice(opts.value.lastIndexOf('@') + 1);

  return bare
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
};

/** The host of `scheme://[user@]host[:port]/path` or `[user@]host[:port]/path`; `undefined` for a socket or nothing. */
const authorityOf = (opts: { value: string }): string | undefined => {
  const rest = /[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(opts.value)?.[1] ?? opts.value;
  const host = /^(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#\s]+)/.exec(rest)?.[1];

  return host === undefined
    ? undefined
    : host
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '')
        .toLowerCase();
};

const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Words that open a command inside a loop, a condition or a group: the command is what follows. */
const SHELL_KEYWORDS = new Set([
  'do',
  'then',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
  'coproc',
]);

const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'httpie', 'xh', 'xhs']);

/** Programs that run the rest of their line; the options each takes a value for are in `hooks/shell.ts`. */
const WRAPPERS = new Set([
  'sudo',
  'doas',
  'env',
  'time',
  'nohup',
  'nice',
  'ionice',
  'exec',
  'stdbuf',
  'timeout',
  'setsid',
  'xargs',
  'watch',
  'sshpass',
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash']);

/** Look a command up or describe it; running none of the words that follow. */
const LOOKUPS = new Set(['man', 'which', 'type', 'whereis', 'apropos', 'whatis', 'echo', 'printf']);

const SSH_ARGUMENT_LETTERS: Record<string, string> = {
  ssh: 'BbcDEeFIiJLlmOopQRSWw',
  sftp: 'BbcDFiJlOoPRSsX',
  scp: 'cDFiJlOoPSX',
  mosh: 'p',
  'ssh-copy-id': 'iopt',
  'ssh-keyscan': 'ptT',
};

const NETWORK_CLIENTS = new Set(['nc', 'ncat', 'netcat', 'telnet']);
const NETWORK_ARGUMENT_LETTERS = 'pswiIOTxXPZ';
const KUBERNETES_CLIENTS = new Set(['kubectl', 'helm', 'k9s', 'oc']);
const KUBERNETES_TARGET_OPTIONS = [
  '--context',
  '--kube-context',
  '--cluster',
  '--server',
  '--kube-apiserver',
  '-s',
];

/** Clients whose target this guard does not parse: they always ask. */
const UNPARSED_CLIENTS =
  /^(?:autossh|pssh|pscp|pslurp|prsync|parallel-ssh|parallel-scp|pdsh|clush|dbclient|plink|putty|socat|rsh|rcp|rlogin|ftp|lftp|tftp|cssh|tssh|ansible(?:-[\w-]+)?)$/;

const SENSITIVE_ASSIGNMENT =
  /(?:^|[\s;&|(])(?:export\s+)?(?:git_ssh(?:_command)?|rsync_rsh|docker_host|docker_context|kubeconfig)=|core\.sshcommand/i;
const URL_HOST = /(?:ssh|scp|sftp|rsync):\/\/(?:[^@\s/'"]*@)?(\[[^\]]+\]|[^\s/:'"]+)/gi;
const DEVICE_HOST = /\/dev\/(?:tcp|udp)\/([^/\s'"]+)\//gi;

const UNSAFE_OPTION_KEYS = new Set(['proxycommand', 'localcommand', 'knownhostscommand']);

// --- the strict read-only forms ---

const LABEL = '\\w[\\w-]*';
const REMOTE_PATH = '/[\\w./-]*';
const LOCAL_PATH = '(?:\\./)?\\w[\\w-]*(?:[./][\\w-]+)*/?';
const UNIT = '[\\w@][\\w.@-]*';

const READ_ONLY_REMOTE = new RegExp(
  `^(?:${[
    'uptime',
    'hostname',
    'df -h',
    'free -m',
    'docker ps(?: -a)?',
    'docker compose ps',
    `ls(?: -[a-zA-Z]+)? ${REMOTE_PATH}`,
    `cat ${REMOTE_PATH}`,
    `tail -n \\d+ ${REMOTE_PATH}`,
    `systemctl status ${UNIT}(?: --no-pager)?`,
    `journalctl -u ${UNIT} -n \\d+ --no-pager`,
    `docker logs --tail \\d+ ${UNIT}`,
  ].join('|')})$`,
);
const COPY_SOURCE = new RegExp(`^(?:${LABEL}(?:\\.${LABEL})*@)?[^@\\s/:]+:${REMOTE_PATH}$`);
const COPY_TARGET = new RegExp(`^${LOCAL_PATH}$`);
const SCP_SAFE_FLAGS = /^-[rpqC]+$/;
const RSYNC_SAFE_FLAGS = /^-[avzrhPt]+$/;
const KUBECTL_READ_VERBS = new Set(['get', 'describe', 'logs', 'top']);
const KUBECTL_SAFE_WORD = /^[\w./=:,@-]+$/;

// --- per-client analysis ---

const unreadable = (opts: { why: string }): IFinding => ({
  hosts: [],
  unreadable: opts.why,
  strict: false,
  redirect: false,
});

interface IOptionEffect {
  hosts: string[];
  unreadable?: string;
}

/** What one ssh-family option means for where the connection goes. */
const optionEffect = (opts: { letter: string; value: string }): IOptionEffect => {
  const { letter, value } = opts;

  if (letter === 'J') {
    return { hosts: value.split(',').map((jump) => hostOf({ value: jump.replace(/:\d+$/, '') })) };
  }

  if (letter === 'F' || letter === 'S') {
    return { hosts: [], unreadable: `-${letter} ${value} can redirect the connection` };
  }

  if (letter === 'W') {
    return { hosts: [hostOf({ value: value.replace(/:\d+$/, '') })] };
  }

  if (letter !== 'o') {
    return { hosts: [] };
  }

  const [key = '', ...rest] = value.split(/[=\s]+/);
  const setting = rest.join('=').trim();

  if (UNSAFE_OPTION_KEYS.has(key.toLowerCase())) {
    return { hosts: [], unreadable: `-o ${key} runs a command` };
  }

  if (key.toLowerCase() === 'proxyjump' && setting.toLowerCase() !== 'none') {
    return {
      hosts: setting.split(',').map((jump) => hostOf({ value: jump.replace(/:\d+$/, '') })),
    };
  }

  return { hosts: key.toLowerCase() === 'hostname' ? [hostOf({ value: setting })] : [] };
};

/** `ssh`, `sftp`, `mosh`, `ssh-copy-id`, `ssh-keyscan`: options, then the destination, then a remote command. */
const analyzeSsh = (opts: { program: string; words: string[] }): IFinding => {
  const letters = SSH_ARGUMENT_LETTERS[opts.program] ?? '';
  const hosts: string[] = [];
  const positionals: string[] = [];
  let why: string | undefined;
  let sawOption = false;
  let command: string[] = [];
  const keyscan = opts.program === 'ssh-keyscan';

  for (let index = 1; index < opts.words.length; index++) {
    const word = opts.words[index] ?? '';

    if (word === '--') {
      const rest = opts.words.slice(index + 1);

      if (positionals.length === 0 || keyscan) {
        positionals.push(...rest.slice(0, 1));
        command = keyscan ? [] : rest.slice(1);
      } else {
        command = rest;
      }

      break;
    }

    if (word.startsWith('--') && opts.program === 'mosh') {
      sawOption = true;
      why ??= /^--(?:ssh|server)\b/.test(word) ? `${word.split('=')[0]} runs a command` : undefined;
      continue;
    }

    if (word.startsWith('-') && word.length > 1) {
      sawOption = true;

      for (let position = 1; position < word.length; position++) {
        const letter = word[position] ?? '';

        if (keyscan && letter === 'f') {
          why ??= '-f reads the hosts from a file';
        }

        if (!letters.includes(letter)) {
          continue;
        }

        const attached = word.slice(position + 1);
        const value = attached !== '' ? attached : (opts.words[++index] ?? '');
        const effect = optionEffect({ letter, value });

        hosts.push(...effect.hosts);
        why ??= effect.unreadable;
        break;
      }

      continue;
    }

    if (positionals.length === 0 || keyscan) {
      positionals.push(word);
      continue;
    }

    command = opts.words.slice(index);
    break;
  }

  if (positionals.length === 0) {
    return unreadable({ why: `${opts.program} names no destination` });
  }

  hosts.push(...positionals.map((positional) => hostOf({ value: positional })));

  return {
    hosts,
    ...(why === undefined ? {} : { unreadable: why }),
    strict:
      opts.program === 'ssh' &&
      !sawOption &&
      command.length > 0 &&
      READ_ONLY_REMOTE.test(command.join(' ')),
    redirect: false,
    ...(opts.program === 'ssh' && command.length > 0 ? { remote: command } : {}),
  };
};

/** `user@host:path`, `host::module` or a `scheme://` URL: the host, else `undefined` for a local path. */
const copySpecHost = (opts: { word: string }): string | undefined => {
  const { word } = opts;

  if (word.startsWith('-') || /^(?:\/|\.{1,2}\/|~)/.test(word)) {
    return undefined;
  }

  if (/^(?:ssh|scp|sftp|rsync):\/\//i.test(word)) {
    return hostOf({ value: word });
  }

  const spec = /^(?:[^@\s/:]+@)?(\[[0-9a-f:.]+\]|[^@\s/:]+):/i.exec(word);

  return spec?.[1] === undefined ? undefined : hostOf({ value: spec[1] });
};

/** `-e`/`--rsh` that is a plain `ssh` (with a port or key) leaves the host as typed; anything else may add a hop. */
const PLAIN_RSH = /^ssh(?: -[pi] \S+)*$/;

/** `scp`, `rsync`, `sshfs`: every `host:path` is a host; options may add a jump or run a command. */
const analyzeCopy = (opts: { program: string; words: string[] }): IFinding => {
  const hosts: string[] = [];
  const positionals: string[] = [];
  const flags: string[] = [];
  let why: string | undefined;
  const scp = opts.program === 'scp' || opts.program === 'sshfs';
  const letters = SSH_ARGUMENT_LETTERS.scp ?? '';

  for (let index = 1; index < opts.words.length; index++) {
    const word = opts.words[index] ?? '';

    if (word.startsWith('--')) {
      const rsh = /^--rsh(?:=(.*))?$/.exec(word);

      if (rsh !== null) {
        const value = rsh[1] ?? opts.words[++index] ?? '';

        why ??= PLAIN_RSH.test(value)
          ? undefined
          : `--rsh "${value}" can add a hop or run a command`;
      }

      flags.push(word);
      continue;
    }

    if (word.startsWith('-') && word.length > 1) {
      flags.push(word);

      for (let position = 1; position < word.length; position++) {
        const letter = word[position] ?? '';
        const takesArgument = scp ? letters.includes(letter) : letter === 'e';

        if (!takesArgument) {
          continue;
        }

        const attached = word.slice(position + 1);
        const value = attached !== '' ? attached : (opts.words[++index] ?? '');

        if (letter === 'e') {
          why ??= PLAIN_RSH.test(value)
            ? undefined
            : `-e "${value}" can add a hop or run a command`;
        } else {
          const effect = optionEffect({ letter, value });

          hosts.push(...effect.hosts);
          why ??= effect.unreadable;
        }

        break;
      }

      continue;
    }

    positionals.push(word);
  }

  const specs = positionals.map((positional) => copySpecHost({ word: positional }));

  hosts.push(...specs.flatMap((spec) => (spec === undefined ? [] : [spec])));

  const safe = flags.every((flag) => (scp ? SCP_SAFE_FLAGS : RSYNC_SAFE_FLAGS).test(flag));
  const [source = '', target = ''] = positionals;

  return {
    hosts,
    ...(why === undefined ? {} : { unreadable: why }),
    strict:
      safe &&
      positionals.length === 2 &&
      COPY_SOURCE.test(source) &&
      specs[0] !== undefined &&
      specs[1] === undefined &&
      COPY_TARGET.test(target),
    redirect: false,
  };
};

/** The value of `--name value` / `--name=value`, wherever it stands. */
const optionValues = (opts: { words: string[]; names: string[] }): string[] =>
  opts.words.flatMap((word, index) => {
    const name = opts.names.find(
      (candidate) => word === candidate || word.startsWith(`${candidate}=`),
    );

    if (name === undefined) {
      return [];
    }

    return [word === name ? (opts.words[index + 1] ?? '') : word.slice(name.length + 1)];
  });

const analyzeKubernetes = (opts: { program: string; words: string[] }): IFinding => {
  if (opts.words.some((word) => word === '--kubeconfig' || word.startsWith('--kubeconfig='))) {
    return unreadable({ why: '--kubeconfig points at contexts this guard cannot read' });
  }

  const targets = optionValues({ words: opts.words, names: KUBERNETES_TARGET_OPTIONS });

  if (targets.length === 0) {
    return {
      ...unreadable({ why: `${opts.program} uses the current kubeconfig context` }),
      ambient: true,
    };
  }

  const hosts = targets.map((target) =>
    target.includes('://') ? new URL(target).hostname : target.toLowerCase(),
  );
  const contexts = optionValues({ words: opts.words, names: ['--context'] });
  const rest: string[] = [];

  for (let index = 1; index < opts.words.length; index++) {
    const word = opts.words[index] ?? '';

    if (word === '--context') {
      index++;
    } else if (!word.startsWith('--context=')) {
      rest.push(word);
    }
  }

  const [verb = ''] = rest;

  return {
    hosts,
    strict:
      opts.program === 'kubectl' &&
      contexts.length === 1 &&
      targets.length === 1 &&
      KUBECTL_READ_VERBS.has(verb) &&
      rest.every((word) => KUBECTL_SAFE_WORD.test(word)),
    redirect: false,
  };
};

const analyzeNetwork = (opts: { words: string[] }): IFinding => {
  const positionals: string[] = [];

  for (let index = 1; index < opts.words.length; index++) {
    const word = opts.words[index] ?? '';

    if (word.startsWith('-') && word.length > 1) {
      const last = word[word.length - 1] ?? '';

      if (NETWORK_ARGUMENT_LETTERS.includes(last)) {
        index++;
      }

      continue;
    }

    positionals.push(word);
  }

  return positionals.length === 0
    ? unreadable({ why: 'no host to connect to' })
    : { hosts: [hostOf({ value: positionals[0] ?? '' })], strict: false, redirect: false };
};

/** `curl`, `wget`, `http`: a URL or bare address names a host; only a listed one matters. */
const analyzeHttp = (opts: { words: string[] }): IFinding => {
  const hosts = opts.words.slice(1).flatMap((word) => {
    const candidate = /\s/.test(word) ? /[a-z][a-z0-9+.-]*:\/\/\S*/i.exec(word)?.[0] : word;

    if (candidate === undefined || (candidate.startsWith('-') && !candidate.includes('://'))) {
      return [];
    }

    const host = authorityOf({ value: candidate });

    return host === undefined ? [] : [host];
  });

  return { hosts, strict: false, redirect: false, listedOnly: true };
};

/** `-H`/`--host` name the daemon; a context or `docker context` resolves elsewhere and cannot be read. */
const analyzeDocker = (opts: { words: string[] }): IFinding => {
  const hosts: string[] = [];

  for (let index = 1; index < opts.words.length; index++) {
    const word = opts.words[index] ?? '';

    if (/^(?:-c|--context)(?:=|$)/.test(word) || word === 'context') {
      return unreadable({ why: 'docker is pointed at another host or context' });
    }

    const long = /^--host(?:=(.*))?$/.exec(word);
    const short = /^-H(.*)$/.exec(word);
    const given = long ?? short;

    if (given === null) {
      continue;
    }

    const value = given[1] ?? '';
    const host = authorityOf({ value: value === '' ? (opts.words[++index] ?? '') : value });

    if (host !== undefined) {
      hosts.push(host);
    }
  }

  return { hosts, strict: false, redirect: false };
};

/** Whether a shell with no `-c` takes its commands from its input: no script file, or `-s`. */
const readsItsInput = (opts: { words: string[] }): boolean => {
  if (opts.words.includes('<')) {
    return true;
  }

  for (const word of opts.words.slice(1)) {
    if (!word.startsWith('-')) {
      return false;
    }

    if (/^-[a-z]*s[a-z]*$/.test(word)) {
      return true;
    }
  }

  return true;
};

const MAXIMUM_DEPTH = 4;

/** Skips a wrapper's own options (and the values its options take); the words after are its command. */
const unwrap = (opts: { program: string; words: string[] }): string[] => {
  let index = 1;

  while (index < opts.words.length) {
    const word = opts.words[index] ?? '';

    if (word.startsWith('-') && word.length > 1) {
      index += optionTakesNextWord({ wrapper: opts.program, word }) ? 2 : 1;
    } else if (
      ENVIRONMENT_ASSIGNMENT.test(word) ||
      (/^\d[\w.]*$/.test(word) && opts.program !== 'sshpass')
    ) {
      index++;
    } else {
      break;
    }
  }

  return opts.words.slice(index);
};

/** The findings of one command's words, following wrappers, `sh -c`, `eval` and `find -exec`. */
const analyzeWords = (opts: {
  words: string[];
  depth: number;
  /** Reads a command string (`sh -c`, `eval`): the whole analysis again, one level deeper. */
  recurse: (opts: { command: string; depth: number }) => IFinding[];
}): IFinding[] => {
  const words = [...opts.words];

  while (
    words[0] !== undefined &&
    (ENVIRONMENT_ASSIGNMENT.test(words[0]) || SHELL_KEYWORDS.has(words[0]))
  ) {
    words.shift();
  }

  const program = basenameOf({ word: words[0] ?? '' });

  if (program === '' || LOOKUPS.has(program) || opts.depth > MAXIMUM_DEPTH) {
    return opts.depth > MAXIMUM_DEPTH ? [unreadable({ why: 'the command nests too deeply' })] : [];
  }

  if (program === 'command' && words.some((word) => word === '-v' || word === '-V')) {
    return [];
  }

  if (program === 'env') {
    // `env -S "ssh host"` carries a whole command line in one word: the command it makes is read as one.
    const splits = programOf({
      command: { words, redirects: [], assignments: [] },
    }).splitCommands;

    if (splits.length > 0) {
      return splits.flatMap((splitWords) =>
        analyzeWords({ words: splitWords, depth: opts.depth + 1, recurse: opts.recurse }),
      );
    }
  }

  if (WRAPPERS.has(program) || program === 'command' || program === 'builtin') {
    return analyzeWords({
      words: unwrap({ program, words }),
      depth: opts.depth + 1,
      recurse: opts.recurse,
    });
  }

  if (program === 'eval') {
    return opts.recurse({
      command: words.slice(1).join(' '),
      depth: opts.depth + 1,
    });
  }

  if (SHELLS.has(program)) {
    const flag = words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word));

    if (flag !== -1) {
      return opts.recurse({
        command: words[flag + 1] ?? '',
        depth: opts.depth + 1,
      });
    }

    return readsItsInput({ words })
      ? [unreadable({ why: `${program} runs commands it reads from its input` })]
      : [];
  }

  if (program === 'find') {
    const start = words.findIndex((word) => ['-exec', '-execdir', '-ok', '-okdir'].includes(word));

    if (start === -1) {
      return [];
    }

    const tail = words.slice(start + 1);
    const end = tail.findIndex((word) => word === ';' || word === '+');

    return analyzeWords({
      words: end === -1 ? tail : tail.slice(0, end),
      depth: opts.depth + 1,
      recurse: opts.recurse,
    });
  }

  if (program === 'docker') {
    return [analyzeDocker({ words })];
  }

  if (HTTP_CLIENTS.has(program)) {
    return [analyzeHttp({ words })];
  }

  if (program in SSH_ARGUMENT_LETTERS && program !== 'scp') {
    const finding = analyzeSsh({ program, words });
    const nested =
      finding.remote === undefined
        ? []
        : opts
            .recurse({ command: finding.remote.join(' '), depth: opts.depth + 1 })
            .filter((inner) => inner.ambient !== true);

    return [finding, ...nested];
  }

  if (program === 'scp' || program === 'rsync' || program === 'sshfs') {
    return [analyzeCopy({ program, words })];
  }

  if (KUBERNETES_CLIENTS.has(program)) {
    return [analyzeKubernetes({ program, words })];
  }

  if (NETWORK_CLIENTS.has(program)) {
    return [analyzeNetwork({ words })];
  }

  return UNPARSED_CLIENTS.test(program)
    ? [unreadable({ why: `the target of ${program} is not parsed` })]
    : [];
};

const analyzeCommand = (opts: { command: string; depth: number }): IFinding[] =>
  tokenize({ command: opts.command }).flatMap((segment) => {
    const findings = analyzeWords({
      words: segment.words,
      depth: opts.depth,
      recurse: analyzeCommand,
    });

    return findings.map((finding): IFinding =>
      segment.substitution && (finding.hosts.length > 0 || finding.unreadable !== undefined)
        ? {
            ...finding,
            unreadable: finding.unreadable ?? 'a substitution runs inside it',
            redirect: finding.redirect || segment.redirect,
          }
        : { ...finding, redirect: finding.redirect || segment.redirect },
    );
  });

// --- the decision ---

const trustedMessage = (opts: { host: string; policy: IRemoteHostsPolicy }): string =>
  `reaching '${opts.host}', which is not in remoteHosts.trusted (list it there${opts.policy.localFile === undefined ? '' : `, or in ${opts.policy.localFile} for yourself`}); a remoteHosts.readOnly host passes only the strict read-only forms`;

const readOnlyMessage = (opts: { host: string }): string =>
  `'${opts.host}' is a remoteHosts.readOnly host: only a strict read-only form passes (uptime, df -h, cat <path>, scp/rsync from it, kubectl get|describe|logs|top), and this command is not one`;

/** Why each host this command reaches may not be reached without asking; empty means nothing to ask. */
export const inspectRemoteCommand = (opts: {
  command: string;
  policy: IRemoteHostsPolicy;
}): IWriteHit[] => {
  const { command, policy } = opts;
  const findings = analyzeCommand({ command, depth: 0 });
  const hits: IWriteHit[] = [];
  const asked = new Set<string>();

  const ask = (message: string): void => {
    if (!asked.has(message)) {
      asked.add(message);
      hits.push({ rule: 'remote-hosts', message });
    }
  };

  for (const finding of findings) {
    if (finding.unreadable !== undefined) {
      ask(
        `the target of this command cannot be read (${finding.unreadable}), so any host could be reached`,
      );
      continue;
    }

    for (const host of finding.hosts) {
      if (matchesHost({ host, entries: policy.trusted })) {
        continue;
      }

      if (matchesHost({ host, entries: policy.readOnly })) {
        if (!finding.strict || finding.redirect) {
          ask(readOnlyMessage({ host }));
        }

        continue;
      }

      if (finding.listedOnly !== true) {
        ask(trustedMessage({ host, policy }));
      }
    }
  }

  const devices = [...command.matchAll(DEVICE_HOST)].map((match) =>
    hostOf({ value: match[1] ?? '' }),
  );
  const urls = [...command.matchAll(URL_HOST)].map((match) => hostOf({ value: match[1] ?? '' }));

  for (const host of [...devices, ...urls]) {
    if (!matchesHost({ host, entries: policy.trusted })) {
      ask(trustedMessage({ host, policy }));
    }
  }

  if (SENSITIVE_ASSIGNMENT.test(command)) {
    ask(
      'the target of this command cannot be read (an environment variable or git option redirects ssh, rsync, docker or kubectl)',
    );
  }

  return hits;
};

export const buildRemoteDecision = (opts: { hits: IWriteHit[] }) =>
  forHost({
    output: {
      hookSpecificOutput: {
        hookEventName: HookConstants.PRE_TOOL_USE,
        permissionDecision: HookConstants.GUARD_DECISION,
        permissionDecisionReason: [
          'This command may reach a remote host the project has not listed:',
          ...opts.hits.map((hit) => `  - ${hit.message}`),
          '',
          'Read on the host, never edit, restart or copy onto it. Produce the command and hand it over.',
        ].join('\n'),
      },
    },
  });
