import type { TConstValue } from '../common/types.ts';
import type { IWriteCheck, IWriteHit } from './common/index.ts';
import { ShellParser } from './shell.ts';
import { ShellWrites } from './shell-writes.ts';
import type { ISimpleCommand } from './shell.ts';

/** The options a program takes before its verb (`kubectl -n prod apply`), each with or without a value. */
const OPTIONS = String.raw`(?:\s+-\S+(?:\s+[^\s-]\S*)?)*`;

/** A verb ends at a blank, a quote or an operator, so `set` is not `set-context`. */
const VERB_END = String.raw`(?=[\s"';|&)]|$)`;

/** A program name starts a word: `ssh` is not `sh`, `deploy.sh` is not `sh`. */
const PROGRAM_START = String.raw`(?:^|[^\w.-])`;

/** The rest of one simple command, for a verb that may come anywhere after the program. */
const REST = String.raw`[^|;&\n]*?`;

/** curl's short options that take no value: in a cluster such as `-sd x`, the letters before the one that does. */
const CURL_SWITCHES = '0-9:#aBfgGhiIjJklLMnNOpqRsSvVZ';

/** curl's long options that take the next word as their value. */
const CURL_VALUED_LONG = [
  'abstract-unix-socket',
  'alt-svc',
  'aws-sigv4',
  'cacert',
  'capath',
  'cert',
  'cert-type',
  'ciphers',
  'config',
  'connect-timeout',
  'connect-to',
  'continue-at',
  'cookie',
  'cookie-jar',
  'data',
  'data-ascii',
  'data-binary',
  'data-raw',
  'data-urlencode',
  'dump-header',
  'etag-compare',
  'etag-save',
  'expect100-timeout',
  'form',
  'form-string',
  'header',
  'hsts',
  'interface',
  'json',
  'key',
  'key-type',
  'limit-rate',
  'local-port',
  'login-options',
  'mail-from',
  'mail-rcpt',
  'max-filesize',
  'max-time',
  'noproxy',
  'oauth2-bearer',
  'output',
  'output-dir',
  'pass',
  'parallel-max',
  'preproxy',
  'proto',
  'proto-redir',
  'proxy',
  'proxy-header',
  'proxy-user',
  'quote',
  'range',
  'referer',
  'request',
  'resolve',
  'retry',
  'retry-delay',
  'retry-max-time',
  'socks5',
  'socks5-hostname',
  'speed-limit',
  'speed-time',
  'stderr',
  'time-cond',
  'trace',
  'trace-ascii',
  'unix-socket',
  'upload-file',
  'url',
  'user',
  'user-agent',
  'variable',
  'write-out',
].join('|');

/** A curl word that takes the next word as its value, so that word is a value and never an option. */
const CURL_VALUED = String.raw`^(?:-[${CURL_SWITCHES}]*[${ShellWrites.CURL_VALUED_SHORT}]|--(?:${CURL_VALUED_LONG}))$`;

const MUTATING_METHOD = '(?:POST|PUT|PATCH|DELETE|post|put|patch|delete)';

/** A blank or a block comment between two words of a SQL statement. */
const SQL_GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/)+`;

/**
 * A SQL keyword starts at a word boundary, or right after the option that carries it (`-cDELETE`,
 * `-eDELETE`): the shell gives an attached value as one word with its option.
 */
const SQL_START = String.raw`(?:(?<![\w$])|(?<=\s-[A-Za-z0-9]{0,8}[ce]))`;

const SQL_WRITE = [
  String.raw`(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)(?=[\s;]|\/\*|$)`,
  String.raw`(?:merge|replace)${SQL_GAP}into\b`,
  String.raw`call${SQL_GAP}[\w."]+\s*\(`,
  String.raw`\\?copy${SQL_GAP}[\w."]+(?:\s*\([^)]*\))?${SQL_GAP}from\b`,
  String.raw`(?:vacuum|reindex)(?=[\s;(]|\/\*|$)`,
  String.raw`refresh${SQL_GAP}materialized${SQL_GAP}view\b`,
  // `cluster` and `lock` are host names too (`psql -h cluster`): they count as a statement's shape only.
  String.raw`cluster(?:\s*(?:;|$)|${SQL_GAP}verbose\b|${SQL_GAP}[\w."]+\s*(?:;|$|using\b))`,
  String.raw`lock${SQL_GAP}(?:table\b|[\w."]+(?:${SQL_GAP}in\b|\s*(?:;|$)))`,
  String.raw`(?:pg_terminate_backend|pg_cancel_backend|setval|nextval|lo_unlink|pg_drop_replication_slot|pg_reload_conf)\s*\(`,
].join('|');

/** The words that make a call change nothing: help, and a dry run (`--dry-run=none` and `=false` run for real). */
const INERT = String.raw`^(?:--help|-h|-help|--dry-run(?:=(?!(?:none|false)$).*)?)$`;

/** For a database tool, where `-h` names the host: only help and the version. */
const HELP_ONLY = String.raw`^(?:--help|--version|-V|-\?)$`;

/** How redis-cli is read: its options, and what it is called with that only reads. */
class RedisCli {
  /** The options that take the next word, so a value (`-h cache`) is never read as the command. */
  static readonly VALUES: readonly string[] = [
    '-h',
    '-p',
    '-s',
    '-a',
    '-u',
    '-r',
    '-i',
    '-n',
    '-d',
    '-D',
    '-t',
    '--user',
    '--pass',
    '--sni',
    '--cacert',
    '--cacertdir',
    '--cert',
    '--key',
    '--tls-ciphers',
    '--tls-ciphersuites',
    '--pattern',
    '--quoted-pattern',
    '--count',
    '--rdb',
    '--functions-rdb',
    '--pipe-timeout',
    '--memkeys-samples',
  ];
  /** The commands that only read; any other command, and the prompt (no command), asks. */
  static readonly READS = [
    'GET|MGET|STRLEN|EXISTS|TYPE|TTL|PTTL|KEYS|SCAN|SSCAN|HSCAN|ZSCAN|INFO|PING|DBSIZE|TIME|ECHO',
    'HGET|HGETALL|HKEYS|HVALS|HLEN|HMGET|HEXISTS',
    'LRANGE|LLEN|LINDEX|SMEMBERS|SCARD|SISMEMBER|SRANDMEMBER',
    'ZRANGE|ZRANGEBYSCORE|ZREVRANGE|ZCARD|ZSCORE|ZRANK',
    'OBJECT|LATENCY|COMMAND',
    'CLIENT[ \t]+LIST|CONFIG[ \t]+GET|MEMORY[ \t]+USAGE|SLOWLOG[ \t]+GET',
  ].join('|');
  /** The modes that only read: they scan or sample the server and send no command. */
  static readonly READ_MODES = '^(?:--scan|--bigkeys|--stat|--latency)$';
}

/** How httpie and xh are read: their options, the methods that only read, and the items that send data. */
class Httpie {
  /** The options that take the next word, so a value (`-a user:pass`) is never read as the URL. */
  static readonly VALUES: readonly string[] = [
    '-a',
    '--auth',
    '-A',
    '--auth-type',
    '-o',
    '--output',
    '--session',
    '--session-read-only',
    '--verify',
    '--cert',
    '--cert-key',
    '--cert-key-pass',
    '--proxy',
    '--timeout',
    '--pretty',
    '-s',
    '--style',
    '-p',
    '--print',
    '-P',
    '--history-print',
    '--max-redirects',
    '--default-scheme',
    '--ssl',
    '--ciphers',
    '--format-options',
    '--response-charset',
    '--response-mime',
    '--boundary',
    '--unix-socket',
    '--resolve',
    '--interface',
    '--http-version',
    '--raw',
  ];
  static readonly READS = '(?:GET|HEAD|OPTIONS)';
  /**
   * A request item that sends data, so a POST: its first separator is `=` (not `==`, a query parameter),
   * `:=` or `@`. A `Name:value` header has `:` first.
   */
  static readonly DATA = '[ \\t](?!-)[^\\s:=@|;&]*(?:=(?!=)|:=|@)';
}

/** One row of the table: a program, with its aliases, and what it is called with that writes. */
interface IWriteCommandRow {
  rule: 'V-W-02' | 'V-W-03';
  what: string;
  /** The names it is run by. None: the pattern stands alone (`db:migrate` in any command). */
  programs: readonly string[];
  /**
   * The verbs that write, each a run of words split by blanks, a word being alternatives (`state rm`,
   * `up|down`). They come first after the program's options, or anywhere in it when `isAnywhere`.
   */
  verbs?: readonly string[];
  /** Verbs that start like a write and only read (`rollout status`). */
  reads?: readonly string[];
  isAnywhere?: boolean;
  /** A shape the verbs cannot say, as regular expression source after the program. */
  pattern?: string;
  /** A word that makes a call of the program change nothing (`--help`, `--dry-run`, `--check`). */
  inert?: string;
  /** A word that takes the next word as its value: that value is never read as an `inert` word (`curl -A -G`). */
  valued?: string;
  ignoreCase?: boolean;
}

/** Why the SQL a database client runs cannot be seen. */
class SqlUnseen {
  static readonly INPUT =
    'writing to a database through SQL that comes from a pipe or a file, which this check cannot see';
  static readonly FILE =
    'writing to a database through a SQL file whose contents this check cannot see';
  static readonly BUILT =
    'writing to a database through SQL built when the command runs, which this check cannot see';
}

/** Where a database client takes what it runs. */
class SqlClientModes {
  /** An option carries the SQL (`psql -c`, `mysql -e`). */
  static readonly INLINE = 'inline';
  /** The words after the database file are SQL, and dot-commands (`sqlite3`). */
  static readonly SQLITE = 'sqlite';
  /** `--eval`, `--file` or a `.js` file (`mongosh`). */
  static readonly MONGO = 'mongo';
}

type TSqlClientMode = TConstValue<typeof SqlClientModes>;

interface ISqlClient {
  mode: TSqlClientMode;
  /** The option that carries code on the line; the group is a value attached to it. */
  inline: RegExp;
}

/** A row ready to match: its pattern, and what makes a call of its programs change nothing. */
export interface ICommandCheck extends IWriteCheck {
  programs: ReadonlySet<string>;
  inert: RegExp | undefined;
  valued: RegExp | undefined;
}

const DEPLOY = 'deploying or hot-applying to a cluster';
const CLOUD = 'deploying or changing cloud resources';
const MIGRATION = 'running a migration instead of handing it to the human';
const DATABASE = 'writing to a database';
const REQUEST = 'calling an endpoint that mutates data';

/**
 * The commands `guard-writes` asks about, one row per program and its aliases, ordered by how much damage the
 * action does. A verb not listed reads and stays silent; adding a command is adding a row.
 */
export class WriteCommands {
  static readonly ROWS: readonly IWriteCommandRow[] = [
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['kubectl', 'oc'],
      verbs: [
        'apply|patch|delete|scale|rollout|create|replace|set|edit|run|label|annotate|drain|cordon|uncordon|taint|expose',
      ],
      reads: ['rollout status|history'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['./kc'],
      verbs: ['apply|patch|delete'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['docker'],
      verbs: [
        'compose up|down|restart',
        'stack deploy|up|rm|remove|down',
        'service create|update|rm|remove|scale|rollback',
        'swarm init|join|leave|update|unlock',
      ],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['docker-compose'],
      verbs: ['up|down|restart'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['helm'],
      verbs: ['upgrade|install|rollback|uninstall|delete'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['helmfile'],
      verbs: ['apply|sync|destroy|delete'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['argocd'],
      verbs: ['app sync|delete|create'],
      inert: INERT,
    },
    { rule: 'V-W-03', what: DEPLOY, programs: ['skaffold'], verbs: ['run|deploy'], inert: INERT },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['terraform', 'tofu', 'terragrunt'],
      verbs: ['apply|destroy|import|taint', 'state rm'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['pulumi'],
      verbs: ['up|update|destroy|refresh'],
      inert: INERT,
    },
    { rule: 'V-W-03', what: CLOUD, programs: ['cdk'], verbs: ['deploy|destroy'], inert: INERT },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['flyctl', 'fly'],
      verbs: ['deploy|scale|destroy', 'secrets set', String.raw`\S+ destroy`],
      reads: ['scale show'],
      inert: INERT,
    },
    { rule: 'V-W-03', what: CLOUD, programs: ['vercel'], verbs: ['deploy|--prod'], inert: INERT },
    { rule: 'V-W-03', what: CLOUD, programs: ['netlify'], verbs: ['deploy'], inert: INERT },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['wrangler'],
      verbs: ['deploy|publish|delete', 'secret put'],
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['gcloud'],
      verbs: ['deploy|delete|create|update|set-iam-policy'],
      isAnywhere: true,
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['az'],
      verbs: ['create|delete|update|deploy'],
      isAnywhere: true,
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['aws'],
      verbs: [
        String.raw`(?:update|put|delete|create|terminate|stop|reboot|modify|attach|detach|register|deregister|start)-[\w-]+|run-instances`,
        's3 rm|sync|mv|rb|mb',
        'cloudformation deploy',
      ],
      isAnywhere: true,
      inert: `${INERT}|^--dryrun$`,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['aws'],
      // `aws s3 cp` to a bucket: past its options, the source, then an `s3://` word after it.
      pattern: String.raw`${REST}\ss3\s+cp\s+(?:-\S+\s+)*[^\s-]\S*\s(?:[^|;&\n]*\s)?['"]?s3:\/\/`,
      inert: `${INERT}|^--dryrun$`,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['ansible-playbook'],
      inert: `${INERT}|^(?:--check|-C|--syntax-check|--list-hosts|--list-tasks|--list-tags)$`,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['ansible'],
      // A module that changes the host, or `-a` with no `-m`, which runs the `command` module.
      pattern: [
        String.raw`${REST}\s(?:-m\s*|--module-name[=\s]+)['"]?(?:shell|command|raw|script|copy|file|service|systemd|template|lineinfile)\b`,
        String.raw`(?![^|;&\n]*\s(?:-m|--module-name))${REST}\s(?:-a|--args)(?=[\s=]|$)`,
      ]
        .map((alternative) => `(?:${alternative})`)
        .join('|'),
      inert: `${INERT}|^(?:--check|-C)$`,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: [],
      pattern: String.raw`\bdb:migrate(?!:status\b)\b|\bmigrate:(dev|local|alpha|develop)\b|make\s+db-migrate\b`,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['drizzle-kit'],
      verbs: ['push|migrate|up|drop'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['prisma'],
      verbs: ['migrate deploy|reset|resolve', 'db push|execute'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['prisma'],
      verbs: ['migrate dev'],
      // `--create-only` writes the migration file and runs nothing.
      inert: `${INERT}|^--create-only$`,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['knex'],
      verbs: ['migrate:latest|migrate:up|migrate:down|migrate:rollback'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['typeorm', 'typeorm-ts-node-commonjs', 'typeorm-ts-node-esm'],
      verbs: ['migration:run|migration:revert|schema:drop|schema:sync'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['alembic'],
      verbs: ['upgrade|downgrade|stamp'],
      // `--sql` prints the SQL of the migration (offline mode) and connects to nothing.
      inert: `${INERT}|^--sql$`,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['manage.py', 'django-admin'],
      verbs: ['migrate|flush|loaddata'],
      inert: `${INERT}|^--plan$`,
    },
    {
      rule: 'V-W-02',
      what: 'opening a shell on the project or its database, whose commands this check cannot see',
      programs: ['manage.py', 'django-admin'],
      verbs: ['shell|dbshell'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['flyway'],
      verbs: ['migrate|clean|baseline|repair'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['goose'],
      verbs: ['up|down|reset|redo|up-by-one|up-to|down-to'],
      isAnywhere: true,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['dbmate'],
      verbs: ['up|down|drop|rollback|migrate'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['supabase'],
      verbs: ['db push|reset'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['sequelize', 'sequelize-cli'],
      verbs: [String.raw`db:migrate(?::[\w:]+)?|db:seed(?::[\w:]+)?`],
      reads: ['db:migrate:status'],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['rails', 'rake'],
      verbs: [
        'db:migrate|db:drop|db:reset|db:seed|db:rollback|db:setup|db:schema:load|db:structure:load',
      ],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: MIGRATION,
      programs: ['artisan'],
      verbs: [String.raw`migrate(?::(?:fresh|refresh|reset|rollback))?|db:seed|db:wipe`],
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: DATABASE,
      programs: [],
      pattern: String.raw`\b(?:psql|mysql|mariadb|mongosh|mongo|sqlite3)\b[^|]*?${SQL_START}(?:${SQL_WRITE})|\bmongo(?:sh)?\b[^|]*?\.(?:insert|update|delete|remove|replace|drop|bulkWrite|findOneAnd|findAndModify|createCollection|createIndex|renameCollection|runCommand|adminCommand)\w*\s*\(`,
      ignoreCase: true,
    },
    {
      rule: 'V-W-02',
      what: SqlUnseen.FILE,
      programs: [],
      pattern: String.raw`\b(psql|mysql|mariadb)\b[^|]*\s-f\s|\bpsql\b[^|]*\s(?:-[aAbeEHlnqsStwWxX0-9z]*f|--file\b)`,
    },
    {
      rule: 'V-W-02',
      what: 'running a redis-cli command that is not a known read, or its prompt',
      programs: ['redis-cli'],
      pattern: String.raw`${WriteCommands.optionsOf({ values: RedisCli.VALUES })}(?![ \t]+(?:${RedisCli.READS})${VERB_END})`,
      inert: `${HELP_ONLY}|${RedisCli.READ_MODES}`,
      ignoreCase: true,
    },
    {
      rule: 'V-W-02',
      what: DATABASE,
      programs: ['dropdb', 'createdb', 'createuser', 'dropuser', 'mongoimport'],
      inert: HELP_ONLY,
    },
    {
      rule: 'V-W-02',
      what: DATABASE,
      programs: ['pg_restore'],
      inert: `${HELP_ONLY}|^(?:-l|--list)$`,
    },
    {
      rule: 'V-W-02',
      what: DATABASE,
      programs: ['mongorestore'],
      inert: `${HELP_ONLY}|^--dryRun$`,
    },
    {
      rule: 'V-W-02',
      what: DATABASE,
      programs: ['mysqladmin'],
      verbs: ['drop|create|shutdown'],
      isAnywhere: true,
      inert: HELP_ONLY,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['curl'],
      // A request body sent with `-d` or `--data*`. With `-G` (`--get`) curl sends that data in the URL of a GET.
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*d|--data\b)`,
      inert: `${INERT}|^(?:--get$|-[${CURL_SWITCHES}]*G)`,
      valued: CURL_VALUED,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*[FT]|--(?:json|form|upload-file)\b)`,
      inert: INERT,
      valued: CURL_VALUED,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*X\s*|--request(?:=|\s+))['"]?${MUTATING_METHOD}\b`,
      inert: INERT,
      valued: CURL_VALUED,
    },
    {
      rule: 'V-W-02',
      what: 'calling an endpoint with options read from a file this check cannot see',
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*K|--config\b)`,
      inert: INERT,
      valued: CURL_VALUED,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['wget'],
      pattern: String.raw`${REST}\s(?:--post-(?:data|file)|--body-(?:data|file)|--method(?:=|\s+)['"]?${MUTATING_METHOD}\b)`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      // httpie's `-h` prints headers, so only `--help` and `--offline` send nothing.
      programs: ['http', 'https', 'xh', 'xhs'],
      // A raw body; past the options, a method that is not a read, or no method and a data item after the URL.
      pattern: [
        String.raw`(?=${REST}[ \t]--raw\b)`,
        `${WriteCommands.optionsOf({ values: Httpie.VALUES })}(?:${[
          String.raw`[ \t]+(?!${Httpie.READS}[ \t])[A-Za-z]+[ \t]+\S`,
          // The URL is read whole, so a long one is not tried again at every shorter length.
          String.raw`[ \t]+(?![A-Za-z]+[ \t]+\S)(?=(?<url>[^\s|;&]+))\k<url>[^|;&\n]*?${Httpie.DATA}`,
        ].join('|')})`,
      ].join('|'),
      inert: '^(?:--help|--offline)$',
      ignoreCase: true,
    },
  ];

  /**
   * Database clients and where they take what they run. `inline` is the option that carries SQL on the line,
   * its value attached or the next word; with none (and no heredoc) a client reads SQL from its input.
   * `sqlite3` takes SQL as the words after the database file; `mongosh` takes `--eval`, `--file` or a file.
   */
  static readonly SQL_CLIENTS: Readonly<Record<string, ISqlClient>> = {
    psql: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[aAbeEHlnqsStwWxX0-9z]*c|--command(?:=|$))([\s\S]*)$/,
    },
    mysql: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[BNnqrstvX]*e|--execute(?:=|$))([\s\S]*)$/,
    },
    mariadb: {
      mode: SqlClientModes.INLINE,
      inline: /^(?:-[BNnqrstvX]*e|--execute(?:=|$))([\s\S]*)$/,
    },
    sqlite3: { mode: SqlClientModes.SQLITE, inline: /^--?cmd(?:=|$)([\s\S]*)$/ },
    mongosh: { mode: SqlClientModes.MONGO, inline: /^--eval(?:=|$)([\s\S]*)$/ },
    mongo: { mode: SqlClientModes.MONGO, inline: /^--eval(?:=|$)([\s\S]*)$/ },
  };

  /** The options that make a database client only print something and read nothing. */
  static readonly SQL_CLIENT_INFO = new Set([
    '-l',
    '--list',
    '-V',
    '--version',
    '-version',
    '--help',
    '-help',
    '-?',
  ]);

  /** The `sqlite3` options that take the next word. */
  static readonly SQLITE_VALUES = new Set([
    '-cmd',
    '-init',
    '-separator',
    '-newline',
    '-nullvalue',
    '-vfs',
    '-mmap',
    '-pagecache',
    '-lookaside',
    '-heap',
    '-maxsize',
  ]);

  /** A client command that runs a SQL file: psql's `\i`, mysql's `source` and `\.`, sqlite3's `.read`. */
  static readonly SQL_FILE_COMMAND =
    /(?:^|;)\s*(?:\\(?:i|ir|include|include_relative|\.)\s|source\s|\.(?:read|import|restore)\s)/im;

  /** The rows, compiled. */
  static readonly CHECKS: readonly ICommandCheck[] = WriteCommands.ROWS.map((row) =>
    WriteCommands.compile({ row }),
  );

  /**
   * The options before a program's command, read whole, as a pattern: a value (`-h cache`) is never the command,
   * and no shorter run is tried, so a look at the command that follows cannot be passed by backing off.
   */
  private static optionsOf(opts: { values: readonly string[] }): string {
    const option = String.raw`[ \t]+(?:(?:${opts.values.join('|')})[ \t]+[^\s|;&]+|-[^\s|;&]*)`;

    return String.raw`(?=(?<options>(?:${option})*))\k<options>`;
  }

  /** A run of words, each a set of alternatives, with the program's options allowed between them. */
  private static wordsOf(opts: { verb: string }): string {
    return opts.verb
      .split(' ')
      .map((word) => `(?:${word})`)
      .join(`${OPTIONS}\\s+`);
  }

  private static compile(opts: { row: IWriteCommandRow }): ICommandCheck {
    const { row } = opts;
    const names = row.programs.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    const head = names.length === 0 ? '' : `${PROGRAM_START}(?:${names.join('|')})`;
    const verbs = (row.verbs ?? []).map((verb) => WriteCommands.wordsOf({ verb })).join('|');
    const reads = (row.reads ?? []).map((verb) => WriteCommands.wordsOf({ verb })).join('|');
    const notRead = reads === '' ? '' : `(?!(?:${reads})${VERB_END})`;
    const body = WriteCommands.bodyOf({ row, verbs, notRead });

    return {
      rule: row.rule,
      what: row.what,
      pattern: new RegExp(`${head}${body}`, row.ignoreCase === true ? 'i' : ''),
      programs: new Set(row.programs.map((name) => ShellParser.basenameOf({ word: name }))),
      inert: row.inert === undefined ? undefined : new RegExp(row.inert),
      valued: row.valued === undefined ? undefined : new RegExp(row.valued),
    };
  }

  /** What follows the program: its own pattern, its verbs (first, or anywhere), or nothing (any call writes). */
  private static bodyOf(opts: { row: IWriteCommandRow; verbs: string; notRead: string }): string {
    const { row, verbs, notRead } = opts;

    // The name ends where the pattern starts: `ansible` is not `ansible-playbook`.
    if (row.pattern !== undefined) {
      return row.programs.length === 0 ? row.pattern : `${VERB_END}(?:${row.pattern})`;
    }

    if (verbs === '') {
      return VERB_END;
    }

    if (row.isAnywhere === true) {
      return `${VERB_END}${REST}\\s${notRead}(?:${verbs})${VERB_END}`;
    }

    return `${OPTIONS}\\s+${notRead}(?:${verbs})${VERB_END}`;
  }

  /**
   * Whether a check applies to a call of `program` with `args`: not when the program is one of the check's
   * own and a word makes the call change nothing (`kubectl apply --dry-run=client`, `curl -G -d q=x`).
   */
  static isLive(opts: { check: ICommandCheck; program: string; args: readonly string[] }): boolean {
    const { inert, valued } = opts.check;

    if (inert === undefined || !opts.check.programs.has(opts.program)) {
      return true;
    }

    let isValue = false;

    for (const word of opts.args) {
      if (isValue) {
        isValue = false;
        continue;
      }

      if (inert.test(word)) {
        return false;
      }

      isValue = valued?.test(word) === true;
    }

    return true;
  }
  /**
   * What a database client runs that the line does not show: SQL from its input (a pipe, a `<` file, the
   * terminal), a file it is told to run, or SQL built when the command runs (`psql -c "$SQL"`).
   */
  static inspectClient(opts: { command: ISimpleCommand }): IWriteHit[] {
    const { name, args } = ShellParser.programOf({ command: opts.command });
    const client = WriteCommands.SQL_CLIENTS[ShellParser.basenameOf({ word: name })];

    if (client === undefined || args.some((word) => WriteCommands.SQL_CLIENT_INFO.has(word))) {
      return [];
    }

    const values = WriteCommands.valuesOf({ args, option: client.inline });
    const hasHeredoc = opts.command.heredoc !== undefined;

    switch (client.mode) {
      case SqlClientModes.SQLITE: {
        return WriteCommands.sqliteHitsOf({
          args: WriteCommands.withoutInput({ args, command: opts.command }),
          values,
          hasHeredoc,
        });
      }
      case SqlClientModes.MONGO: {
        const hasFile = args.some(
          (word, index) =>
            /^(?:--file(?:=|$)|-f$)/.test(word) ||
            (/\.(?:js|mongodb)$/.test(word) && !WriteCommands.isValueAt({ args, index, client })),
        );

        if (hasFile) {
          return [WriteCommands.hitOf({ message: SqlUnseen.FILE })];
        }

        return values.length === 0 && !hasHeredoc
          ? [WriteCommands.hitOf({ message: SqlUnseen.INPUT })]
          : [];
      }
      default: {
        if (values.length === 0) {
          return hasHeredoc ? [] : [WriteCommands.hitOf({ message: SqlUnseen.INPUT })];
        }

        return WriteCommands.valueHitsOf({ values });
      }
    }
  }

  /** The words of a command without the files of its `<` redirects, which the shell puts among them. */
  private static withoutInput(opts: {
    args: readonly string[];
    command: ISimpleCommand;
  }): string[] {
    const files = [...(opts.command.input?.files ?? [])];

    return opts.args.filter((word) => {
      const at = files.indexOf(word);

      if (at === -1) {
        return true;
      }

      files.splice(at, 1);

      return false;
    });
  }

  /** `sqlite3 [options] FILE [SQL...]`: no SQL reads the input; `-init` and `.read` run a file. */
  private static sqliteHitsOf(opts: {
    args: readonly string[];
    values: string[];
    hasHeredoc: boolean;
  }): IWriteHit[] {
    const { args } = opts;
    const positional: string[] = [];
    let hasInit = false;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';
      const option = word.startsWith('--') ? word.slice(1) : word;

      if (!word.startsWith('-')) {
        positional.push(word);
        continue;
      }

      hasInit ||= option === '-init';
      index += WriteCommands.SQLITE_VALUES.has(option) ? 1 : 0;
    }

    if (hasInit) {
      return [WriteCommands.hitOf({ message: SqlUnseen.FILE })];
    }

    const sql = [...positional.slice(1), ...opts.values];

    if (sql.length === 0) {
      return opts.hasHeredoc ? [] : [WriteCommands.hitOf({ message: SqlUnseen.INPUT })];
    }

    return WriteCommands.valueHitsOf({ values: sql });
  }

  /** SQL on the line that runs a file, or that the shell builds when the command runs. */
  private static valueHitsOf(opts: { values: readonly string[] }): IWriteHit[] {
    const hits: IWriteHit[] = [];

    if (opts.values.some((value) => /[$`]/.test(value))) {
      hits.push(WriteCommands.hitOf({ message: SqlUnseen.BUILT }));
    }

    if (opts.values.some((value) => WriteCommands.SQL_FILE_COMMAND.test(value))) {
      hits.push(WriteCommands.hitOf({ message: SqlUnseen.FILE }));
    }

    return hits;
  }

  /** The values of `option` among `args`: attached to it, or the next word. */
  private static valuesOf(opts: { args: readonly string[]; option: RegExp }): string[] {
    const values: string[] = [];

    opts.args.forEach((word, index) => {
      const match = opts.option.exec(word);

      if (match === null) {
        return;
      }

      const attached = match[1] ?? '';
      const next = opts.args[index + 1];

      if (attached !== '') {
        values.push(attached);
        return;
      }

      if (next !== undefined) {
        values.push(next);
      }
    });

    return values;
  }

  /** Whether the word at `index` is the value of the client's inline option. */
  private static isValueAt(opts: {
    args: readonly string[];
    index: number;
    client: ISqlClient;
  }): boolean {
    const previous = opts.args[opts.index - 1];

    return previous !== undefined && opts.client.inline.exec(previous)?.[1] === '';
  }

  private static hitOf(opts: { message: string }): IWriteHit {
    return { rule: 'V-W-02', message: opts.message };
  }
}
