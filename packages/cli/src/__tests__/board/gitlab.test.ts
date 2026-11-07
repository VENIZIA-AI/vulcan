import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardGitlab } from '../../board/gitlab.ts';
import { BoardSettings } from '../../board/settings.ts';
import { BoardAgentInfo } from '../../board/ui/state/agent-info.ts';
import { BoardUrl } from '../../board/ui/url.ts';
import type { IBoardViewEvent } from '../../board/ui/common/types.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const HOST = 'gitlab.test';
const PROJECT = 'acme/platform/shop';
const BASE = 'projects/acme%2Fplatform%2Fshop';
const SINCE = Date.parse('2026-11-01T00:00:00Z');
const WEB = 'https://gitlab.test/acme/platform/shop';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** Answers `glab api --hostname <host> <endpoint>` from `fixtures.json` (the endpoint without its query) and logs every call. */
const FAKE_GLAB = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(import.meta.dir + '/calls.log', JSON.stringify(args) + '\\n');
const fixtures = JSON.parse(readFileSync(import.meta.dir + '/fixtures.json', 'utf8'));
const answer = args[0] === 'api' && args[1] === '--hostname' ? fixtures[args[3].split('?')[0]] : undefined;
if (answer === undefined || answer.fail !== undefined) {
  process.stderr.write((answer?.fail ?? '404 Not Found') + '\\nsecond line\\n');
  process.exit(1);
}
process.stdout.write(typeof answer.raw === 'string' ? answer.raw : JSON.stringify(answer.body));
`;

/** What the fake `glab` answers, by endpoint without its query: invented data in the shape of GitLab 17. */
const FIXTURES: Record<string, unknown> = JSON.parse(
  readFileSync(join(import.meta.dir, 'gitlab-fixtures.json'), 'utf8'),
);
const updated = '2026-11-02T10:00:00Z';

const originalPath = process.env.PATH ?? '';

/** A folder with a `glab` that answers `fixtures`, put first on this process's PATH. */
const installGlab = (opts: { fixtures?: Record<string, unknown> } = {}) => {
  const folder = createProject({ files: {} });

  writeFileSync(join(folder, 'glab'), FAKE_GLAB);
  chmodSync(join(folder, 'glab'), 0o755);
  writeFileSync(join(folder, 'fixtures.json'), JSON.stringify(opts.fixtures ?? FIXTURES));
  writeFileSync(join(folder, 'calls.log'), '');
  process.env.PATH = `${folder}:${originalPath}`;

  return {
    folder,
    calls: (): string[][] =>
      readFileSync(join(folder, 'calls.log'), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
  };
};

const read = (opts: { repos?: string[]; cwd?: string; host?: string } = {}) =>
  BoardGitlab.read({
    repos: opts.repos ?? [PROJECT],
    cwd: opts.cwd ?? createProject({ files: {} }),
    since: SINCE,
    host: opts.host ?? HOST,
  });

beforeEach(() => {
  process.env.PATH = originalPath;
});
afterEach(() => {
  process.env.PATH = originalPath;
});

describe('BoardGitlab.read: a project in sub-groups', () => {
  test('merge requests, approvals, jobs and commits become the lines of their flows', () => {
    installGlab();

    const { events, note } = read();
    const byId = Object.fromEntries(events.map((event) => [event.id, event]));
    const kinds = (kind: string) => events.filter((event) => event.kind === kind).length;

    expect(kinds('pr')).toBe(3);
    expect(kinds('merge')).toBe(1);
    expect(kinds('review')).toBe(1);
    expect(kinds('ci')).toBe(4);
    expect(kinds('commit')).toBe(2);
    expect(events.every((event) => event.source === 'gitlab')).toBe(true);
    expect(byId[`gl:${PROJECT}!7:mr`]).toMatchObject({
      flowId: 'VULZ-ACME-3',
      actor: 'ana',
      status: 'open',
      summary: '!7 Add the cart',
      ref: { repo: PROJECT, pr: 7 },
      link: `${WEB}/-/merge_requests/7`,
    });
    expect(byId[`gl:${PROJECT}!7:merge`]).toMatchObject({
      kind: 'merge',
      status: 'done',
      ts: '2026-11-02T10:00:00Z',
    });
    expect(byId[`gl:${PROJECT}!7:review-0`]).toMatchObject({
      kind: 'review',
      actor: 'ben',
      status: 'pass',
      ts: updated,
      flowId: 'VULZ-ACME-3',
    });
    expect(byId[`gl:${PROJECT}!8:closed`]).toMatchObject({
      status: 'closed',
      flowId: 'Unsorted',
      ts: '2026-11-03T09:00:00Z',
    });
    expect(events.some((event) => event.id.includes('!1:'))).toBe(false);
    expect(note).toContain(
      'gitlab: acme/platform/shop 2 merge request(s), 4 pipeline(s), 2 commit(s)',
    );
  });

  test('a failed and a passing job of a merge request pipeline; unfinished and manual jobs are left out', () => {
    installGlab();

    const ci = read().events.filter((event) => event.kind === 'ci');
    const byId = Object.fromEntries(ci.map((event) => [event.id, event]));

    expect(byId[`gl:${PROJECT}:ci-1`]).toMatchObject({
      check: 'lint',
      status: 'fail',
      actor: 'CI',
      flowId: 'VULZ-ACME-3',
      ref: { repo: PROJECT, pr: 7 },
      link: `${WEB}/-/jobs/1`,
    });
    expect(byId[`gl:${PROJECT}:ci-2`]).toMatchObject({ check: 'test', status: 'pass' });
    expect(byId[`gl:${PROJECT}:ci-3`]).toBeUndefined();
    expect(ci.some((event) => event.id.endsWith('ci-pipeline-103'))).toBe(false);
  });

  test('a pipeline on the default branch belongs to no flow; one with no readable jobs is one line, on its merge request by ref', () => {
    installGlab();

    const byId = Object.fromEntries(read().events.map((event) => [event.id, event]));

    expect(byId[`gl:${PROJECT}:ci-4`]).toMatchObject({
      check: 'build',
      status: 'pass',
      flowId: 'Unsorted',
      ref: { repo: PROJECT },
    });
    expect(byId[`gl:${PROJECT}:ci-4`]?.ref?.pr).toBeUndefined();
    expect(byId[`gl:${PROJECT}:ci-pipeline-102`]).toMatchObject({
      check: 'pipeline',
      status: 'pass',
      flowId: 'Unsorted',
      ref: { repo: PROJECT, pr: 8 },
    });
  });

  test('two commits on the default branch: the Flow line decides the flow', () => {
    installGlab();

    const commits = read().events.filter((event) => event.kind === 'commit');

    expect(commits.map((event) => [event.id, event.flowId, event.actor, event.summary])).toEqual([
      [`gl:${PROJECT}:commit-a1b2c3d4`, 'VULZ-ACME-3', 'Ana', 'Fix totals'],
      [`gl:${PROJECT}:commit-b2c3d4e5`, 'Unsorted', 'Cy', 'Bump dependencies'],
    ]);
    expect(commits[0]?.link).toBe(`${WEB}/-/commit/${SHA_A}`);
  });

  test('every call is a glab api GET on the configured host, with the path encoded and the limits set', () => {
    const fake = installGlab();

    read();

    const calls = fake.calls();

    expect(calls.length).toBeGreaterThan(8);

    for (const call of calls) {
      expect(call.slice(0, 3)).toEqual(['api', '--hostname', HOST]);
      expect(call).toHaveLength(4);
      expect(call[3]).toStartWith(BASE);
    }

    const endpoints = calls.map((call) => call[3] as string);

    expect(endpoints).toContain(
      `${BASE}/merge_requests?state=all&order_by=updated_at&updated_after=2026-11-01T00%3A00%3A00.000Z&per_page=30`,
    );
    expect(endpoints).toContain(
      `${BASE}/pipelines?order_by=updated_at&updated_after=2026-11-01T00%3A00%3A00.000Z&per_page=30`,
    );
    expect(endpoints).toContain(
      `${BASE}/repository/commits?ref_name=main&since=2026-11-01T00%3A00%3A00.000Z&per_page=30`,
    );
    expect(endpoints).toContain(`${BASE}/pipelines/100/jobs?per_page=30`);
    expect(endpoints.some((endpoint) => endpoint.includes('pipelines/103/jobs'))).toBe(false);
  });

  test('the jobs of at most 10 pipelines are read; the rest are one line each', () => {
    const listed = FIXTURES[`${BASE}/pipelines`] as { body: object[] };
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...listed.body[1],
      id: 200 + index,
    }));
    const fake = installGlab({
      fixtures: { ...FIXTURES, [`${BASE}/pipelines`]: { body: many } },
    });
    const { events } = read();
    const jobCalls = fake.calls().filter((call) => /pipelines\/\d+\/jobs/.test(call[3] ?? ''));

    expect(jobCalls).toHaveLength(10);
    expect(events.filter((event) => event.id.includes('ci-pipeline-'))).toHaveLength(12);
  });
});

describe('BoardGitlab.read: it never throws', () => {
  test('glab missing is a note', () => {
    process.env.PATH = createProject({ files: {} });

    expect(read()).toEqual({ events: [], note: 'gitlab: skipped, glab is not installed' });
  });

  test('a project glab cannot read (not logged in, no access) is a note with the first line of the reason', () => {
    const fake = installGlab({ fixtures: { [BASE]: { fail: '401 Unauthorized' } } });
    const { events, note } = read();

    expect(events).toEqual([]);
    expect(note).toBe('gitlab: acme/platform/shop skipped (401 Unauthorized)');
    expect(fake.calls()).toHaveLength(1);
  });

  test('a call that fails or answers with no JSON skips that part and keeps the rest', () => {
    installGlab({
      fixtures: {
        ...FIXTURES,
        [`${BASE}/merge_requests`]: { fail: '500 Server Error' },
        [`${BASE}/pipelines`]: { raw: 'not json' },
        [`${BASE}/repository/commits`]: { raw: '{"a":' },
      },
    });

    const { events, note } = read();

    expect(events).toEqual([]);
    expect(note).toContain('merge requests skipped (500 Server Error)');
    expect(note).toContain('pipelines skipped (glab did not answer with JSON)');
    expect(note).toContain('commits skipped (glab did not answer with JSON)');
  });

  test('a failed approvals call skips the approvals of that merge request only', () => {
    installGlab({
      fixtures: { ...FIXTURES, [`${BASE}/merge_requests/7/approvals`]: { fail: '403 Forbidden' } },
    });

    const { events, note } = read();

    expect(events.filter((event) => event.kind === 'review')).toEqual([]);
    expect(events.filter((event) => event.kind === 'pr')).toHaveLength(3);
    expect(note).toContain('approvals of !7 skipped (403 Forbidden)');
  });
});

describe('BoardGitlab.read: the project of origin', () => {
  const repoWithOrigin = (url: string): string => {
    const cwd = createProject({ files: { 'README.md': 'x' } });

    initRepo({ cwd });
    git({ cwd, args: ['remote', 'add', 'origin', url] });

    return cwd;
  };

  test.each([
    `ssh://git@${HOST}:2222/${PROJECT}.git`,
    `git@${HOST}:${PROJECT}.git`,
    `https://deploy:secret@${HOST}/${PROJECT}.git`,
  ])('%p names the project when its host is the configured one', (url) => {
    const fake = installGlab();
    const { events, note } = read({ repos: [], cwd: repoWithOrigin(url) });

    expect(events.length).toBeGreaterThan(0);
    expect(note).toStartWith(`gitlab: ${PROJECT} 2 merge request(s)`);
    expect(JSON.stringify(fake.calls())).not.toContain('secret');
  });

  test('a host that is not the configured one is not used', () => {
    const fake = installGlab();
    const { events, note } = read({
      repos: [],
      cwd: repoWithOrigin(`git@gitlab.other.test:${PROJECT}.git`),
    });

    expect(events).toEqual([]);
    expect(note).toBe('gitlab: skipped, this folder is not a GitLab project glab can read');
    expect(fake.calls()).toEqual([]);
  });

  test('no origin, or a folder that is no repository, is the same note', () => {
    installGlab();

    expect(read({ repos: [] }).note).toContain('not a GitLab project');
    expect(read({ repos: [], cwd: repoWithOrigin('/srv/git/shop.git') }).note).toContain(
      'not a GitLab project',
    );
  });

  test('a configured host with a port still matches the host name of the remote', () => {
    installGlab();

    const { note } = read({
      repos: [],
      cwd: repoWithOrigin(`git@${HOST}:${PROJECT}.git`),
      host: `${HOST}:8443`,
    });

    expect(note).toStartWith(`gitlab: ${PROJECT} `);
  });

  test.each([
    [`ssh://git@${HOST}:2222/a/b/c.git`, { host: HOST, path: 'a/b/c' }],
    [`git@${HOST}:a/b.git`, { host: HOST, path: 'a/b' }],
    [`https://user:pw@GitLab.Test/a/b/c/`, { host: HOST, path: 'a/b/c' }],
    [`https://${HOST}/a`, undefined],
    ['/srv/git/shop', undefined],
    ['C:\\work\\shop', undefined],
    ['', undefined],
    [`git@${HOST}:a/b c.git`, undefined],
  ])('parseRemote(%p)', (url, expected) => {
    expect(BoardGitlab.parseRemote({ url })).toEqual(expected);
  });
});

describe('provider in the config and the manifest', () => {
  const parse = (provider: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ provider });
  const manifestOf = (provider?: unknown) =>
    JSON.parse(
      ProjectManifest.render({
        root: createProject({ files: {} }),
        config: VULCAN_CONFIG_SCHEMA.parse(provider === undefined ? {} : { provider }),
      }),
    );

  test('GitHub is the default and writes nothing to the manifest', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).provider).toEqual({ type: 'github' });
    expect(VULCAN_CONFIG_SCHEMA.parse({ provider: {} }).provider).toEqual({ type: 'github' });
    expect(manifestOf().provider).toBeUndefined();
    expect(manifestOf({ type: 'github' }).provider).toBeUndefined();
  });

  test('gitlab, with or without a host, reaches the manifest as written', () => {
    expect(manifestOf({ type: 'gitlab' }).provider).toEqual({ type: 'gitlab' });
    expect(manifestOf({ type: 'gitlab', host: 'git.example.com:8443' }).provider).toEqual({
      type: 'gitlab',
      host: 'git.example.com:8443',
    });
  });

  test.each([
    'gitlab.com',
    'git.example.com',
    'git-1.example.com:8443',
    'localhost',
    '10.0.0.5:80',
  ])('the host %p is accepted', (host) => {
    expect(parse({ type: 'gitlab', host }).success).toBe(true);
  });

  test.each([
    'https://gitlab.com',
    'gitlab.com/group',
    'user@gitlab.com',
    'user:token@gitlab.com',
    'gitlab.com:',
    'gitlab.com:99999x',
    '-gitlab.com',
    'git lab.com',
    '',
  ])('the host %p is refused', (host) => {
    expect(parse({ type: 'gitlab', host }).success).toBe(false);
  });

  test('a host with github or with no type, an unknown type and an unknown key are refused', () => {
    expect(parse({ type: 'github', host: 'gitlab.com' }).success).toBe(false);
    expect(parse({ host: 'gitlab.com' }).success).toBe(false);
    expect(parse({ type: 'bitbucket' }).success).toBe(false);
    expect(parse({ type: 'gitlab', token: 'x' }).success).toBe(false);
  });

  test('the board reads the provider from the manifest, with the default host and github when it is missing or wrong', () => {
    const provider = (manifest: unknown) =>
      BoardSettings.resolve({ manifest, gitUser: undefined, readLogo: () => undefined }).provider;

    expect(provider({})).toEqual({ type: 'github', host: 'gitlab.com' });
    expect(provider(manifestOf({ type: 'gitlab' }))).toEqual({
      type: 'gitlab',
      host: 'gitlab.com',
    });
    expect(provider(manifestOf({ type: 'gitlab', host: 'git.example.com' }))).toEqual({
      type: 'gitlab',
      host: 'git.example.com',
    });
    expect(provider({ provider: { type: 'gitlab', host: 'https://evil.test/x' } }).host).toBe(
      'gitlab.com',
    );
    expect(provider({ provider: { type: 'svn' } }).type).toBe('github');
  });
});

describe('vulcan board with provider gitlab', () => {
  const projectOn = (provider: unknown): string =>
    createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ provider }),
        '.git/HEAD': 'ref: refs/heads/x\n',
      },
    });
  const board = (opts: { root: string; args: string[]; path: string }) =>
    runCli({
      args: ['board', '--since', '2026-11-01', ...opts.args],
      cwd: opts.root,
      env: { ...hermeticEnv(), PATH: opts.path },
    });
  const dataOf = (file: string) =>
    JSON.parse(
      /<script type="application\/json" id="board-data">(.*?)<\/script>/s.exec(
        readFileSync(file, 'utf8'),
      )?.[1] ?? '{}',
    );

  test('--repo takes a path of any depth; the page carries the GitLab lines in their flows', () => {
    const fake = installGlab();
    const root = projectOn({ type: 'gitlab', host: HOST });
    const result = board({ root, args: ['--repo', PROJECT], path: `${fake.folder}:/usr/bin:/bin` });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain(`gitlab: ${PROJECT} 2 merge request(s)`);

    const data = dataOf(result.stdout.trim());
    const flow = data.flows.find((item: { id: string }) => item.id === 'VULZ-ACME-3');

    expect(flow.state).toBe('done');
    expect(flow.events.map((event: { source: string }) => event.source)).toContain('gitlab');
    expect(data.sources[1]).toStartWith('gitlab: ');
    expect(fake.calls().every((call) => call[2] === HOST)).toBe(true);
  });

  test('--no-github leaves GitLab out and says so', () => {
    const fake = installGlab();
    const result = board({
      root: projectOn({ type: 'gitlab' }),
      args: ['--no-github'],
      path: `${fake.folder}:/usr/bin:/bin`,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('gitlab: left out (--no-github)');
    expect(fake.calls()).toEqual([]);
  });

  test('without glab the board still builds and says why', () => {
    const empty = createProject({ files: {} });

    symlinkSync(process.execPath, join(empty, 'bun'));

    const result = board({ root: projectOn({ type: 'gitlab' }), args: [], path: empty });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('gitlab: skipped, glab is not installed');
  });
});

describe('the page', () => {
  const pull = (opts: { source: string; link?: string }) => ({
    repo: 'group/sub/shop',
    source: opts.source,
    n: 7,
    flow: 'F-1',
    ci: null,
    link: opts.link ?? null,
  });

  test('a merge request is `!7`, a pull request `#7`', () => {
    expect(BoardAgentInfo.labelOf({ pr: pull({ source: 'gitlab' }) })).toBe('group/sub/shop!7');
    expect(BoardAgentInfo.labelOf({ pr: pull({ source: 'github' }) })).toBe('group/sub/shop#7');
  });

  test('a merge request on a plain http server keeps its own link', () => {
    const link = 'http://git.internal.example/group/sub/shop/-/merge_requests/7';

    expect(BoardUrl.safe({ value: link })).toBe(link);
    expect(BoardAgentInfo.prHref({ pr: pull({ source: 'gitlab', link }) })).toBe(link);
  });

  test('a merge request with no link gets none, never a github.com address', () => {
    expect(BoardAgentInfo.prHref({ pr: pull({ source: 'gitlab' }) })).toBeUndefined();
    expect(
      BoardAgentInfo.prHref({ pr: { ...pull({ source: 'github' }), repo: 'acme/shop' } }),
    ).toBe('https://github.com/acme/shop/pull/7');
  });

  test('only http and https make a link; an image is https or inline', () => {
    expect(BoardUrl.safe({ value: 'javascript:alert(1)' })).toBeUndefined();
    expect(BoardUrl.safe({ value: 'ftp://example.com/x' })).toBeUndefined();
    expect(BoardUrl.safe({ value: 'http://example.com/logo.svg', image: true })).toBeUndefined();
    expect(BoardUrl.safe({ value: 'https://example.com/logo.svg', image: true })).toBe(
      'https://example.com/logo.svg',
    );
  });

  test('a merge request link is a pull request link of the agent card', () => {
    const event = (opts: Partial<IBoardViewEvent>): IBoardViewEvent =>
      ({
        id: 'x',
        flowId: 'F-1',
        ts: '2026-11-02T08:00:00Z',
        kind: 'pr',
        stage: 4,
        actor: 'ana',
        summary: '!7 Add the cart',
        source: 'gitlab',
        ref: { repo: PROJECT, pr: 7 },
        link: `${WEB}/-/merge_requests/7`,
        ...opts,
      }) as IBoardViewEvent;
    const [pr] = BoardAgentInfo.prsOf({ events: [event({})] });

    expect(pr?.link).toBe(`${WEB}/-/merge_requests/7`);
    expect(BoardAgentInfo.prHref({ pr: pr as NonNullable<typeof pr> })).toBe(
      `${WEB}/-/merge_requests/7`,
    );
  });
});
