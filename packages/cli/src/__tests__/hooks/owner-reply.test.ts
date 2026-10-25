import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPromptContract, buildStopOutput } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

/** A Stop event; the wire names stay behind string-literal access. */
const reply = (opts: {
  text: unknown;
  isRetry?: boolean;
  session?: string;
}): Record<string, unknown> => {
  const event: Record<string, unknown> = {};

  if (opts.session !== undefined) {
    event['session_id'] = opts.session;
  }

  event['last_assistant_message'] = opts.text;
  event['stop_hook_active'] = opts.isRetry === true;

  return event;
};

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
const BAD =
  'Here is a long reply that is not in the report shape at all and has no headline structure, no table and no blocked line.';
const GOOD = [
  'The build passes.',
  '',
  '| # | Task | Status |',
  '|---|------|--------|',
  '| 1 | Build | done |',
  '',
  'Blocked: none',
  '',
  'Nothing else changed.',
  '',
  'Decisions needed',
  '',
  'Nothing needed yet.',
].join('\n');

const project = (enforce: string, extra = ''): string => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.ts': `export default { owner: { report: { enforce: '${enforce}'${extra} } } };\n`,
    },
  });

  mkdirSync(join(root, '.agents/local'), { recursive: true });

  return root;
};

const logOf = (root: string): string => {
  const file = join(root, '.agents/local/violations.jsonl');

  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

describe('buildStopOutput', () => {
  test('advise logs the faults and never blocks', async () => {
    const root = project('advise');

    expect(
      await buildStopOutput({ projectRoot: root, input: reply({ text: BAD }) }),
    ).toBeUndefined();
    expect(logOf(root)).toContain('minimap-missing');
    expect(logOf(root)).not.toContain('long reply');
  });

  test('block sends a structural fault back once, with what to fix, and records it', async () => {
    const root = project('block');
    const output = await buildStopOutput({ projectRoot: root, input: reply({ text: BAD }) });

    expect(output?.decision).toBe('block');
    expect(String(output?.reason)).toContain('minimap-missing');
    expect(logOf(root)).toContain('blocked-missing');
  });

  test('a retry (stop_hook_active) is never blocked again', async () => {
    const root = project('block');
    const input = reply({ text: BAD, isRetry: true });

    expect(await buildStopOutput({ projectRoot: root, input })).toBeUndefined();
  });

  test('a second block right after the first is refused even when the client sends no retry flag', async () => {
    const root = project('block');
    const event = reply({ text: BAD });

    delete event['stop_hook_active'];

    expect((await buildStopOutput({ projectRoot: root, input: event }))?.decision).toBe('block');
    expect(await buildStopOutput({ projectRoot: root, input: event })).toBeUndefined();
  });

  test('a short reply clears the last-reply note', async () => {
    const root = project('advise', ', shortReplyWords: 20');

    await buildStopOutput({ projectRoot: root, input: reply({ text: BAD }) });
    expect(await buildPromptContract({ projectRoot: root })).toContain('broke it');
    await buildStopOutput({ projectRoot: root, input: reply({ text: 'Done.' }) });
    expect(await buildPromptContract({ projectRoot: root })).not.toContain('broke it');
  });

  test('a log that cannot be written never costs the block decision', async () => {
    const root = project('block');

    mkdirSync(join(root, '.agents/local/violations.jsonl'));
    mkdirSync(join(root, '.agents/local/last-reply.json'));

    expect(
      (await buildStopOutput({ projectRoot: root, input: reply({ text: BAD }) }))?.decision,
    ).toBe('block');
  });

  test('a reply in the shape passes; off checks nothing; unreadable input passes', async () => {
    const block = project('block');
    const off = project('off');

    expect(
      await buildStopOutput({ projectRoot: block, input: reply({ text: GOOD }) }),
    ).toBeUndefined();
    expect(logOf(block)).toBe('');
    expect(
      await buildStopOutput({ projectRoot: off, input: reply({ text: BAD }) }),
    ).toBeUndefined();
    expect(logOf(off)).toBe('');

    for (const input of [null, 'text', {}, reply({ text: 3 })]) {
      expect(await buildStopOutput({ projectRoot: block, input })).toBeUndefined();
    }
  });

  test('a short reply is exempt by default, held to the shape when the owner sets 0', async () => {
    const exempt = project('block');
    const strict = project('block', ', shortReplyWords: 0');

    expect(
      await buildStopOutput({ projectRoot: exempt, input: reply({ text: 'Done.' }) }),
    ).toBeUndefined();
    expect(
      (await buildStopOutput({ projectRoot: strict, input: reply({ text: 'Done.' }) }))?.decision,
    ).toBe('block');
  });

  test('style faults alone are logged and never block', async () => {
    const root = project('block');
    const output = await buildStopOutput({
      projectRoot: root,
      input: {
        ...reply({ text: GOOD.replace('Nothing else changed.', 'See `src/a.ts` \u{1F680}.') }),
      },
    });

    expect(output).toBeUndefined();
    expect(logOf(root)).toContain('emoji');
  });
});

describe('two sessions in one project', () => {
  test("a session's next prompt reports its own last reply, not the one that stopped last", async () => {
    const root = project('advise');

    await buildStopOutput({ projectRoot: root, input: reply({ text: BAD, session: 'lane-a' }) });
    await buildStopOutput({ projectRoot: root, input: reply({ text: GOOD, session: 'lane-b' }) });

    expect(await buildPromptContract({ projectRoot: root, session: 'lane-a' })).toContain(
      'Your last reply broke it',
    );
    expect(await buildPromptContract({ projectRoot: root, session: 'lane-b' })).toBe(
      'Owner reply contract: follow the report shape from the session rules.',
    );
    expect(await buildPromptContract({ projectRoot: root, session: 'lane-c' })).not.toContain(
      'broke it',
    );
  });

  test('the other order: the clean session stopping last does not hide the faulty one', async () => {
    const root = project('advise');

    await buildStopOutput({ projectRoot: root, input: reply({ text: GOOD, session: 'lane-b' }) });
    await buildStopOutput({ projectRoot: root, input: reply({ text: BAD, session: 'lane-a' }) });

    expect(await buildPromptContract({ projectRoot: root, session: 'lane-b' })).not.toContain(
      'broke it',
    );
  });

  test("one session's block does not stop a block in another, and each keeps its own cooldown", async () => {
    const root = project('block');
    const event = (session: string): Record<string, unknown> => {
      const input = reply({ text: BAD, session });

      delete input['stop_hook_active'];

      return input;
    };

    expect((await buildStopOutput({ projectRoot: root, input: event('lane-a') }))?.decision).toBe(
      'block',
    );
    expect((await buildStopOutput({ projectRoot: root, input: event('lane-b') }))?.decision).toBe(
      'block',
    );
    expect(await buildStopOutput({ projectRoot: root, input: event('lane-a') })).toBeUndefined();
    expect(await buildStopOutput({ projectRoot: root, input: event('lane-b') })).toBeUndefined();
  });

  test('a session id never leaves the note folder', async () => {
    const root = project('advise');

    await buildStopOutput({
      projectRoot: root,
      input: reply({ text: BAD, session: '../../../escape' }),
    });

    expect(existsSync(join(root, 'escape.json'))).toBe(false);
    expect(readdirSync(join(root, '.agents/local/cache/replies'))).toHaveLength(1);
  });
});

describe('buildPromptContract', () => {
  test("is one line while the shape is held, names the last reply's faults, and is empty when off", async () => {
    const root = project('advise');

    expect(await buildPromptContract({ projectRoot: root })).toBe(
      'Owner reply contract: follow the report shape from the session rules.',
    );

    await buildStopOutput({ projectRoot: root, input: reply({ text: BAD }) });

    const line = await buildPromptContract({ projectRoot: root });

    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('Your last reply broke it');
    expect(await buildPromptContract({ projectRoot: project('off') })).toBe('');
  });
});

describe('the hook files', () => {
  const run = (opts: { hook: string; root: string; stdin: string; env?: Record<string, string> }) =>
    spawnSyncBounded({
      cmd: ['bun', join(HOOKS, `${opts.hook}.ts`)],
      cwd: opts.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, ...opts.env },
      stdin: Buffer.from(opts.stdin),
    });

  test('stop prints the block decision as JSON under block, and nothing under advise', () => {
    const blocking = run({
      hook: 'stop',
      root: project('block'),
      stdin: JSON.stringify(reply({ text: BAD })),
    });
    const advising = run({
      hook: 'stop',
      root: project('advise'),
      stdin: JSON.stringify(reply({ text: BAD })),
    });

    expect(blocking.exitCode).toBe(0);
    expect(JSON.parse(blocking.stdout.toString()).decision).toBe('block');
    expect(advising.exitCode).toBe(0);
    expect(advising.stdout.toString()).toBe('');
  });

  test('both hooks fail open: garbage input passes, and VULCAN_GUARDS=off switches them off', () => {
    const root = project('block');

    for (const hook of ['stop', 'prompt-submit']) {
      const garbage = run({ hook, root, stdin: '{ SECRETWORD' });

      expect(garbage.exitCode).toBe(0);
      expect(garbage.stderr.toString()).not.toContain('SECRETWORD');
    }

    // Off is silent even when the same input would block.
    const event = JSON.stringify(reply({ text: BAD }));

    expect(run({ hook: 'stop', root, stdin: event }).stdout.toString()).toContain('block');
    expect(
      run({ hook: 'stop', root, stdin: event, env: { VULCAN_GUARDS: 'off' } }).stdout.toString(),
    ).toBe('');
    expect(
      run({
        hook: 'prompt-submit',
        root,
        stdin: '{}',
        env: { VULCAN_GUARDS: 'off' },
      }).stdout.toString(),
    ).toBe('');
  });

  test('prompt-submit prints the contract line', () => {
    const result = run({
      hook: 'prompt-submit',
      root: project('advise'),
      stdin: '{"prompt":"hi"}',
    });

    expect(result.stdout.toString()).toContain('Owner reply contract');
  });
});
