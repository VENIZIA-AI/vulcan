import type { IWriteCommandRow } from './common/index.ts';
import { SqlUnseen, WritePatterns } from './common/index.ts';

/** curl's short options that take no value: in a cluster such as `-sd x`, the letters before the one that does. */
const CURL_SWITCHES = '0-9:#aBfgGhiIjJklLMnNOpqRsSvVZ';

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

const DEPLOY = 'deploying or hot-applying to a cluster';

const CLOUD = 'deploying or changing cloud resources';

const MIGRATION = 'running a migration instead of handing it to the human';

const DATABASE = 'writing to a database';

const REQUEST = 'calling an endpoint that mutates data';

/**
 * The commands `guard-writes` asks about, one row per program and its aliases, ordered by how much damage the
 * action does. A verb not listed reads and stays silent; adding a command is adding a row.
 */
export class WriteCommandRows {
  static readonly ROWS: readonly IWriteCommandRow[] = [
    {
      rule: 'V-W-03',
      what: DEPLOY,
      programs: ['kubectl', 'oc'],
      verbs: [
        'apply|patch|delete|scale|rollout|create|replace|set|edit|run|label|annotate|drain|cordon|uncordon|taint|expose|cp|debug|autoscale|exec',
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
        'push',
        'image push',
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
      verbs: [
        'deploy|delete|create|update|set-iam-policy|add-iam-policy-binding',
        'compute instances stop|start',
        'sql instances patch',
        'storage rm',
      ],
      isAnywhere: true,
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['gsutil'],
      verbs: ['rm|cp|mv|rsync'],
      isAnywhere: true,
      inert: INERT,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['az'],
      verbs: ['create|delete|update|deploy', 'vm stop|start|deallocate|restart'],
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
        'lambda invoke',
        'sns publish',
        'sqs send-message|send-message-batch|purge-queue',
        'ec2 authorize-security-group-ingress|authorize-security-group-egress',
        'iam add-user-to-group',
        'ssm send-command',
      ],
      isAnywhere: true,
      inert: `${INERT}|^--dryrun$`,
    },
    {
      rule: 'V-W-03',
      what: CLOUD,
      programs: ['aws'],
      // `aws s3 cp` to a bucket: past its options, the source, then an `s3://` word after it.
      pattern: String.raw`${WritePatterns.REST}\ss3\s+cp\s+(?:-\S+\s+)*[^\s-]\S*\s(?:[^|;&\n]*\s)?['"]?s3:\/\/`,
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
        String.raw`${WritePatterns.REST}\s(?:-m\s*|--module-name[=\s]+)['"]?(?:shell|command|raw|script|copy|file|service|systemd|template|lineinfile)\b`,
        String.raw`(?![^|;&\n]*\s(?:-m|--module-name))${WritePatterns.REST}\s(?:-a|--args)(?=[\s=]|$)`,
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
      pattern: String.raw`\b(?-i:psql|mysql|mariadb|mongosh|mongo|sqlite3)\b[^|]*?${SQL_START}(?:${SQL_WRITE})|\b(?-i:mongo(?:sh)?)\b[^|]*?\.(?:insert|update|delete|remove|replace|drop|bulkWrite|findOneAnd|findAndModify|createCollection|createIndex|renameCollection|runCommand|adminCommand)\w*\s*\(`,
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
      pattern: String.raw`${WriteCommandRows.optionsOf({ values: RedisCli.VALUES })}(?![ \t]+(?:${RedisCli.READS})${WritePatterns.VERB_END})`,
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
      // A request body sent with `-d` or `--data*`. `-G` is not read: curl applies it per `--next` group.
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*d|--data\b)`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*[FT]|--(?:json|form|upload-file)\b)`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*X\s*|--request(?:=|\s+))['"]?${MUTATING_METHOD}\b`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: 'calling an endpoint with options read from a file this check cannot see',
      programs: ['curl'],
      pattern: String.raw`[^|]*\s(?:-[${CURL_SWITCHES}]*K|--config\b)`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      programs: ['wget'],
      pattern: String.raw`${WritePatterns.REST}\s(?:--post-(?:data|file)|--body-(?:data|file)|--method(?:=|\s+)['"]?${MUTATING_METHOD}\b)`,
      inert: INERT,
    },
    {
      rule: 'V-W-02',
      what: REQUEST,
      // httpie's `-h` prints headers, so only `--help` and `--offline` send nothing.
      programs: ['http', 'https', 'xh', 'xhs'],
      // A raw body; past the options, a method that is not a read, or no method and a data item after the URL.
      pattern: [
        String.raw`(?=${WritePatterns.REST}[ \t]--raw\b)`,
        `${WriteCommandRows.optionsOf({ values: Httpie.VALUES })}(?:${[
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
   * The options before a program's command, read whole, as a pattern: a value (`-h cache`) is never the command,
   * and no shorter run is tried, so a look at the command that follows cannot be passed by backing off.
   */
  private static optionsOf(opts: { values: readonly string[] }): string {
    const option = String.raw`[ \t]+(?:(?:${opts.values.join('|')})[ \t]+[^\s|;&]+|-[^\s|;&]*)`;

    return String.raw`(?=(?<options>(?:${option})*))\k<options>`;
  }
}
