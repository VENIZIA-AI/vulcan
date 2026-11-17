import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { PrivateValues } from '../../doctor/private-values.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { runCli } from '../run.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const KEY_HEADER = '-----BEGIN RSA PRIVATE KEY-----';
const TOKEN = `ghp_${'a1B2c3D4'.repeat(3)}`;
const CONFIG = "export default { rules: { 'V-W-01': 'on-user-word' } };\n";

/** A committed project holding exactly `files`. */
const repository = (files: Record<string, string>, opts: { config?: string } = {}): string => {
  const root = createProject({
    files: { '.configs/vulcan.config.mts': opts.config ?? CONFIG, 'package.json': '{}', ...files },
  });

  initRepo({ cwd: root });

  return root;
};

const countsOf = (opts: { root: string; file: string }) =>
  PrivateValues.scan({ root: opts.root, acknowledged: [] }).findings.find(
    (finding) => finding.file === opts.file,
  )?.counts;

describe('PrivateValues.scan: what counts', () => {
  test('each kind is found and counted, per file', () => {
    const root = repository({
      'key.txt': `${KEY_HEADER}\nabc\n${KEY_HEADER}\n`,
      'token.txt': `export GH=${TOKEN}\n`,
      'url.txt': 'db: postgres://admin:hunter22@db.internal:5432/app\n',
      'ip.txt': 'host 10.20.30.40 and 172.16.0.9\n',
      'path.md': 'see /home/alice/work/app and /Users/bob/code and C:\\Users\\carol\\x\\n',
    });

    expect(countsOf({ root, file: 'key.txt' })).toEqual({ 'private-key': 2 });
    expect(countsOf({ root, file: 'token.txt' })).toEqual({ token: 1 });
    expect(countsOf({ root, file: 'url.txt' })).toEqual({ 'url-credentials': 1 });
    expect(countsOf({ root, file: 'ip.txt' })).toEqual({ ipv4: 2 });
    expect(countsOf({ root, file: 'path.md' })).toEqual({ 'machine-path': 3 });
  });

  test('prose about Bearer authentication is not a token, a Bearer credential is', () => {
    const root = repository({
      'prose.md': 'Bearer authentication is used.\nuses bearer authentication scheme\n',
      'real.md': 'Authorization: Bearer abcdef1234567890\n',
    });

    expect(countsOf({ root, file: 'prose.md' })).toBeUndefined();
    expect(countsOf({ root, file: 'real.md' })).toEqual({ token: 1 });
  });

  test('a credential on a command line, in a header, a webhook or a query string is a token', () => {
    const root = repository({
      'curl.md': 'curl -u admin:S3cretPass https://x.example\n',
      'mysql.md': 'mysql -u root -pS3cret app\n',
      'sshpass.md': 'sshpass -p S3cret ssh host\n',
      'flag.md': 'login --password S3cret now\n',
      'header.md': `Authorization: token ${'0a1b2c3d'.repeat(5)}\n`,
      'slack.md': `https://hooks.${'slack'}.com/services/${['T0123ABCD', 'B0123ABCD', 'abcdefghijklmnopqrstuvwx'].join('/')}\n`,
      'aws.md': 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n',
      'sas.md': 'https://a.blob.example.net/c?sv=2022-11-02&sig=AbCdEf0123456789%2Bxyz%3D\n',
    });

    for (const file of [
      'curl.md',
      'mysql.md',
      'sshpass.md',
      'flag.md',
      'header.md',
      'slack.md',
      'aws.md',
      'sas.md',
    ]) {
      expect(countsOf({ root, file }), file).toEqual({ token: 1 });
    }
  });

  test('userinfo with a slash, an at sign or a colon in it, and a DSN key, are URL credentials', () => {
    const root = repository({
      'slash.md': 'https://user:pa/ss@github.com/x\n',
      'at.md': 'https://user:p@ss@github.com/x\n',
      'dsn.md': `https://${'0123456789abcdef'.repeat(2)}@o1.ingest.example.io/42\n`,
    });

    for (const file of ['slash.md', 'at.md', 'dsn.md']) {
      expect(countsOf({ root, file }), file).toEqual({ 'url-credentials': 1 });
    }
  });

  test('flags of other commands, placeholders, prose and a port before an at sign are not counted', () => {
    const root = repository({
      'quiet.md': [
        'mkdir -p dir; ls -p; cp -p a b; ssh -p 22 host; git push -u origin main',
        'sshpass -f pwfile ssh -p 22 host',
        'publish --token $NPM_TOKEN or --token <value>; docker login --password-stdin',
        'Authorization: Bearer authentication; Authorization: Bearer <token>',
        'the password and the token are rotated; init --key ACME; --key is the project key',
        'ssh://git@github.com/x http://localhost:4873/@venizia/vulcan',
      ].join('\n'),
    });

    expect(countsOf({ root, file: 'quiet.md' })).toBeUndefined();
  });

  test('more programs, headers and provider prefixes that carry a credential are a token', () => {
    const files: Record<string, string> = {
      'mysql.md': "mysql -u root -p'S3cret' app\n",
      'redis.md': 'redis-cli -h cache -a S3cretPass ping\n',
      'docker.md': 'docker login -u bot -p S3cretPass registry.example\n',
      'az.md': 'az login -u bot -p S3cretPass\n',
      'sqlcmd.md': 'sqlcmd -S db -U sa -P S3cretPass\n',
      'aws.md': 'aws configure set aws_secret_access_key S3cretValue\n',
      'wget.md': 'wget --http-password S3cret x\n',
      'cookie.md': 'Cookie: session=S3cretValue\n',
      'hf.md': `hf_${'aB3'.repeat(11)}\n`,
      'dop.md': `dop_v1_${'0a1b2c3d'.repeat(8)}\n`,
      'shpat.md': `shpat_${'0a1b2c3d'.repeat(4)}\n`,
      'sendgrid.md': `SG.${'aB3d'.repeat(6)}.${'xY9z'.repeat(11)}\n`,
    };
    const root = repository({ ...files, 'redis-url.md': 'redis://:S3cretPass@cache:6379/0\n' });

    for (const file of Object.keys(files)) {
      expect(countsOf({ root, file }), file).toEqual({ token: 1 });
    }

    expect(countsOf({ root, file: 'redis-url.md' })).toEqual({ 'url-credentials': 1 });
  });

  test('a prompt flag, a variable, a path after --key and a bare token in a URL are not counted', () => {
    const root = repository({
      'quiet.md': [
        'mysql -u root -p mydb; mysqladmin -u root -p status',
        'sshpass -p "$PASS" ssh host; curl -u $USER:$PASS https://x.example; --token ${TOKEN}',
        'docker run -p 8080:80 image; redis-cli -h cache ping',
        'sign --key ~/.ssh/id_rsa; sign --key keys/server.key',
        'Cookie: none; https://abc123@github.com/x',
      ].join('\n'),
    });

    expect(countsOf({ root, file: 'quiet.md' })).toBeUndefined();
  });

  test('loopback, any, broadcast, the documentation ranges and a longer dotted number are not an address', () => {
    const root = repository({
      'ok.txt': [
        '127.0.0.1 0.0.0.0 255.255.255.255',
        '192.0.2.7 198.51.100.9 203.0.113.5',
        'version 1.2.3.4.5 and v10.0.0.1.2',
      ].join('\n'),
    });

    expect(countsOf({ root, file: 'ok.txt' })).toBeUndefined();
  });

  test('the name-equals-value shape and a long hash on their own are not counted', () => {
    const root = repository({
      'quiet.ts': `const tokenizer = 'abc'; const apiKey = 'x'; const sum = '${'a'.repeat(64)}';\n`,
    });

    expect(countsOf({ root, file: 'quiet.ts' })).toBeUndefined();
  });

  test('a finding never holds the text that matched', () => {
    const root = repository({
      'all.txt': `${KEY_HEADER}\n${TOKEN}\nhttps://admin:hunter22@h.example/x\n10.20.30.40\n/home/alice/x\n`,
    });
    const text = JSON.stringify(PrivateValues.scan({ root, acknowledged: [] }));

    for (const secret of ['hunter22', TOKEN, '10.20.30.40', 'alice', 'RSA PRIVATE']) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe('PrivateValues.scan: what is not read', () => {
  const LEAK = 'ip 10.20.30.40\n';

  test.each([
    'bun.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'docs/diagram.drawio',
    'src/__snapshots__/a.snap',
    'src/__tests__/a.ts',
    'src/a.test.ts',
    'packages/x/fixtures/data.txt',
    'packages/x/golden/data.json',
  ])('%s is skipped', (path) => {
    const root = repository({ [path]: LEAK });

    expect(countsOf({ root, file: path })).toBeUndefined();
  });

  test('a file over 1 MB and a binary file are skipped', () => {
    const root = repository({
      'big.txt': `${LEAK}${'x'.repeat(1_000_001)}`,
      'blob.bin': `${LEAK}\u0000binary`,
    });

    expect(countsOf({ root, file: 'big.txt' })).toBeUndefined();
    expect(countsOf({ root, file: 'blob.bin' })).toBeUndefined();
  });

  test('a submodule, a link to a folder and a link to a file outside the project are skipped, never followed', () => {
    const outside = createProject({ files: { 'secret.txt': LEAK, 'inner/x.txt': LEAK } });
    const root = repository({ 'a.txt': 'fine\n' });

    mkdirSync(join(root, 'sub'), { recursive: true });
    git({
      cwd: root,
      args: ['update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},sub`],
    });
    symlinkSync(join(outside, 'inner'), join(root, 'folder-link'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'file-link.txt'));
    git({ cwd: root, args: ['add', 'folder-link', 'file-link.txt'] });

    expect(PrivateValues.scan({ root, acknowledged: [] }).findings).toEqual([]);
  });

  test('a file git does not track is not read, and a folder that is no repository is skipped', () => {
    const root = repository({ '.gitignore': 'local.txt\n' });

    writeFileSync(join(root, 'local.txt'), LEAK);
    writeFileSync(join(root, 'untracked.txt'), LEAK);

    expect(PrivateValues.scan({ root, acknowledged: [] }).findings).toEqual([]);

    const plain = createProject({ files: { 'a.txt': LEAK } });

    expect(PrivateValues.scan({ root: plain, acknowledged: [] })).toEqual({
      findings: [],
      acknowledgedFiles: 0,
      unmatched: [],
    });
  });
});

describe('PrivateValues.scan: acknowledgments', () => {
  const files = {
    'infra/dev/a.env': `${KEY_HEADER}\nip 10.0.0.9\n`,
    'infra/dev/b.env': `${KEY_HEADER}\n`,
    'src/c.ts': 'ip 10.0.0.9\n',
  };
  const entry = (opts: { path: string; kinds?: ('private-key' | 'ipv4')[]; reason?: string }) => ({
    path: opts.path,
    reason: opts.reason ?? 'dev only',
    ...(opts.kinds === undefined ? {} : { kinds: opts.kinds }),
  });

  test('an acknowledged kind in a matching file is not a finding and is counted', () => {
    const root = repository(files);
    const result = PrivateValues.scan({
      root,
      acknowledged: [entry({ path: 'infra/dev/**', kinds: ['private-key'] })],
    });

    expect(result.acknowledgedFiles).toBe(2);
    expect(result.findings.map((finding) => finding.file).sort()).toEqual([
      'infra/dev/a.env',
      'src/c.ts',
    ]);
    expect(result.findings.find((finding) => finding.file === 'infra/dev/a.env')?.counts).toEqual({
      ipv4: 1,
    });
  });

  test('with no kinds every kind of a matching file is acknowledged', () => {
    const root = repository(files);
    const result = PrivateValues.scan({ root, acknowledged: [entry({ path: 'infra/dev/*.env' })] });

    expect(result.acknowledgedFiles).toBe(2);
    expect(result.findings.map((finding) => finding.file)).toEqual(['src/c.ts']);
  });

  test('a glob that matches nothing acknowledges nothing', () => {
    const root = repository(files);
    const result = PrivateValues.scan({ root, acknowledged: [entry({ path: 'nowhere/**' })] });

    expect(result.acknowledgedFiles).toBe(0);
    expect(result.findings).toHaveLength(3);
  });
});

describe('vulcan doctor: the warning', () => {
  test('one warning per file with the kinds and counts, and no text of the value', async () => {
    const root = repository({ 'env/dev.env': `${KEY_HEADER}\nip 10.0.0.9 and 10.0.0.10\n` });
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('env/dev.env');
    expect(warnings[0].message).toContain('1 private-key');
    expect(warnings[0].message).toContain('2 ipv4');
    expect(warnings[0].message).toContain('doctor.privateValues.acknowledged');
    expect(warnings[0].message).not.toContain('10.0.0.9');
  });

  test('files that hold only addresses or machine paths are one warning that names them all; a key keeps its own line', async () => {
    const root = repository({
      'src/policy-a.ts': 'const blocked = "10.20.30.40";\n',
      'src/policy-b.ts': 'const blocked = "10.20.30.41"; const other = "10.20.30.42";\n',
      'docs/setup.md': 'run it in /home/alice/work/app\n',
      'env/dev.env': `${KEY_HEADER}\n`,
    });
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');

    expect(warnings).toHaveLength(2);

    const key = warnings.find((warning) => warning.file === 'env/dev.env');
    const mild = warnings.find((warning) => warning.file === '3 files');

    expect(key?.message).toContain('1 private-key');
    expect(mild?.message).toContain('3 files hold only addresses or machine paths');
    expect(mild?.message).toContain('src/policy-a.ts (1 ipv4)');
    expect(mild?.message).toContain('src/policy-b.ts (2 ipv4)');
    expect(mild?.message).toContain('docs/setup.md (1 machine-path)');
    expect(mild?.message).not.toContain('10.20.30');
    expect(mild?.message).not.toContain('alice');
    expect(mild?.message).toContain('doctor.privateValues.acknowledged');
  });

  test('one file that holds only an address keeps its own line', async () => {
    const root = repository({ 'src/policy.ts': 'const blocked = "10.20.30.40";\n' });
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');

    expect(warnings.map((warning) => warning.file)).toEqual(['src/policy.ts']);
    expect(warnings[0].message).toContain(
      'holds only addresses or machine paths: src/policy.ts (1 ipv4)',
    );
  });

  test('an acknowledged file is counted in one note, not a warning, and the check is never silent', async () => {
    const root = repository(
      { 'env/dev.env': `${KEY_HEADER}\n`, 'env/two.env': `${KEY_HEADER}\n` },
      {
        config: `export default { rules: { 'V-W-01': 'on-user-word' }, doctor: { privateValues: { acknowledged: [{ path: 'env/*.env', kinds: ['private-key'], reason: 'dev keys, replaced by the secret store' }] } } };\n`,
      },
    );
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');
    const result2 = await DoctorRunner.runNotes({ root });
    const notes = result2.filter((note) => note.check === 'private-values');

    expect(warnings).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('2 files acknowledged');
    expect(notes[0].message).toContain('doctor.privateValues.acknowledged');
  });

  test('an entry that matches no file with that kind is a warning, so a stale or broad one is seen', async () => {
    const root = repository(
      { 'env/dev.env': `${KEY_HEADER}\n` },
      {
        config: `export default { rules: { 'V-W-01': 'on-user-word' }, doctor: { privateValues: { acknowledged: [{ path: 'env/*.env', kinds: ['private-key'], reason: 'dev keys' }, { path: 'gone/**', reason: 'old folder' }, { path: 'env/*.env', kinds: ['ipv4'], reason: 'no address here' }] } } };\n`,
      },
    );
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');

    expect(warnings).toHaveLength(2);
    expect(warnings.some((warning) => warning.message.includes('"gone/**" matches no file'))).toBe(
      true,
    );
    expect(
      warnings.some((warning) => warning.message.includes('"env/*.env" (ipv4) matches no file')),
    ).toBe(true);
  });

  test('a clean project has no warning of this kind', async () => {
    const root = repository({ 'src/a.ts': 'export const a = 1;\n' });
    const warnings = await DoctorRunner.runWarnings({ root });

    expect(warnings.filter((warning) => warning.check === 'private-values')).toEqual([]);
  });

  test('a folder that is no repository says nothing', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': CONFIG, 'a.txt': 'ip 10.0.0.9\n' },
    });
    const warnings = await DoctorRunner.runWarnings({ root });

    expect(warnings.filter((warning) => warning.check === 'private-values')).toEqual([]);
  });

  test('the warning never changes the exit code: the same project with and without the value ends the same', async () => {
    const clean = repository({ 'a.txt': 'fine\n' });
    const leaky = repository({ 'a.txt': `${KEY_HEADER}\n` });
    const without = runCli({ args: ['doctor'], cwd: clean, env: hermeticEnv() });
    const withValue = runCli({ args: ['doctor'], cwd: leaky, env: hermeticEnv() });

    expect(withValue.stderr).toContain('warning [private-values] a.txt');
    expect(without.stderr).not.toContain('[private-values]');
    expect(withValue.code).toBe(without.code);
    const result = await DoctorRunner.runChecks({ root: leaky });
    expect(result.map((item) => item.check)).not.toContain('private-values');
  });
});

describe('doctor.privateValues in the config', () => {
  const parse = (acknowledged: unknown) =>
    VULCAN_CONFIG_SCHEMA.safeParse({ doctor: { privateValues: { acknowledged } } });

  test('defaults to nothing acknowledged', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).doctor.privateValues.acknowledged).toEqual([]);
  });

  test('a path, optional kinds and a reason are accepted', () => {
    expect(
      parse([
        { path: 'infra/dev/**', reason: 'dev only' },
        { path: 'a.env', kinds: ['private-key', 'ipv4'], reason: 'dev only' },
      ]).success,
    ).toBe(true);
  });

  test.each([
    ['no reason', { path: 'a' }],
    ['an empty reason', { path: 'a', reason: '' }],
    ['a blank reason', { path: 'a', reason: '   ' }],
    ['an absolute path', { path: '/etc/x', reason: 'r' }],
    ['a path that climbs', { path: '../x', reason: 'r' }],
    ['a path with a climbing segment', { path: 'a/../../x', reason: 'r' }],
    ['an empty path', { path: '', reason: 'r' }],
    ['an unknown kind', { path: 'a', kinds: ['hostname'], reason: 'r' }],
    ['an empty kinds list', { path: 'a', kinds: [], reason: 'r' }],
    ['an unknown key', { path: 'a', reason: 'r', until: '2027' }],
  ])('%s is refused', (_name, entry) => {
    expect(parse([entry]).success).toBe(false);
  });
});
