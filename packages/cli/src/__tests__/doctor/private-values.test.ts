import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { PrivateValues } from '../../doctor/private-values.ts';
import { initRepo } from '../git-repo.helper.ts';
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

  test('a file git does not track is not read, and a folder that is no repository is skipped', () => {
    const root = repository({ '.gitignore': 'local.txt\n' });

    writeFileSync(join(root, 'local.txt'), LEAK);
    writeFileSync(join(root, 'untracked.txt'), LEAK);

    expect(PrivateValues.scan({ root, acknowledged: [] }).findings).toEqual([]);

    const plain = createProject({ files: { 'a.txt': LEAK } });

    expect(PrivateValues.scan({ root: plain, acknowledged: [] })).toEqual({
      findings: [],
      acknowledgedFiles: 0,
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

  test('an acknowledged file is counted in one summary line, and the check is never silent', async () => {
    const root = repository(
      { 'env/dev.env': `${KEY_HEADER}\n`, 'env/two.env': `${KEY_HEADER}\n` },
      {
        config: `export default { rules: { 'V-W-01': 'on-user-word' }, doctor: { privateValues: { acknowledged: [{ path: 'env/*.env', kinds: ['private-key'], reason: 'dev keys, replaced by the secret store' }] } } };\n`,
      },
    );
    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('2 files acknowledged');
    expect(warnings[0].message).toContain('doctor.privateValues.acknowledged');
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

  test('doctor stays green: the warning is never a failure', async () => {
    const root = repository({ 'a.txt': `${KEY_HEADER}\n` });

    mkdirSync(join(root, '.agents'), { recursive: true });

    const result = await DoctorRunner.runWarnings({ root });
    expect(result.length).toBeGreaterThan(0);
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
