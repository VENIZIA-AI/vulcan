import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  checkOwnerShape,
  OWNER_SCHEMA,
  PROFILE_SCHEMA,
  readLastClasses,
  readViolationCounts,
  recordReply,
  resolveOwnerView,
  ShapeClasses,
} from '../../owner/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const view = (change: Record<string, unknown> = {}) =>
  resolveOwnerView({
    owner: OWNER_SCHEMA.parse({ report: { shortReplyWords: 0, ...change } }),
  });

const GOOD = [
  'The build passes and the pull request is open.',
  '',
  '| # | Task | Status |',
  '|---|------|--------|',
  '| 1 | Build | done |',
  '| 2 | Review | in progress |',
  '',
  'Blocked: none',
  '',
  'The checks ran on the head commit; `/repo/a.ts` changed.',
  '',
  '## Decisions needed',
  '',
  '1. Merge now? I recommend **yes**.',
].join('\n');

const classesOf = (text: string, change: Record<string, unknown> = {}): string[] =>
  checkOwnerShape({ text, view: view(change) }).classes;

describe('checkOwnerShape', () => {
  test('a reply in the shape has no fault', () => {
    expect(checkOwnerShape({ text: GOOD, view: view() })).toEqual({ isChecked: true, classes: [] });
  });

  test('"Nothing needed yet." alone under the decisions heading is the none string', () => {
    const text = GOOD.replace('1. Merge now? I recommend **yes**.', 'Nothing needed yet.');

    expect(classesOf(text)).toEqual([]);
  });

  test('a heading, a list or a table first is not a headline; a long headline is cut', () => {
    expect(classesOf(`# Report\n\n${GOOD}`)).toContain(ShapeClasses.HEADLINE_NOT_SENTENCE);
    expect(classesOf(`- a point\n${GOOD}`)).toContain(ShapeClasses.HEADLINE_NOT_SENTENCE);
    expect(classesOf(GOOD.replace('open.', 'open. It is green. It is fast.'))).toContain(
      ShapeClasses.HEADLINE_TOO_LONG,
    );
    expect(
      classesOf(GOOD.replace('open.', 'open. It is green. It is fast.'), {
        headlineMaxSentences: 3,
      }),
    ).toEqual([]);
  });

  test('the minimap needs its header and only the configured statuses', () => {
    expect(classesOf(GOOD.replace('| # | Task | Status |', '| a | b | c |'))).toContain(
      ShapeClasses.MINIMAP_MISSING,
    );
    expect(classesOf(GOOD.replace('| 1 | Build | done |', '| 1 | Build | finished |'))).toContain(
      ShapeClasses.MINIMAP_STATUS,
    );
  });

  test('the Blocked line and the decisions are required, numbered, and end with the recommendation', () => {
    expect(classesOf(GOOD.replace('Blocked: none\n', ''))).toContain(ShapeClasses.BLOCKED_MISSING);
    expect(classesOf(GOOD.replace('## Decisions needed', 'Next'))).toContain(
      ShapeClasses.DECISIONS_MISSING,
    );
    expect(classesOf(GOOD.replace('1. Merge now? I recommend **yes**.', 'Merge now?'))).toContain(
      ShapeClasses.DECISIONS_MALFORMED,
    );
    expect(classesOf(GOOD.replace(' I recommend **yes**.', ''))).toContain(
      ShapeClasses.DECISIONS_NO_RECOMMENDATION,
    );
  });

  test('sections out of order are a fault', () => {
    const [headline, , ...rest] = GOOD.split('\n');
    const text = [
      headline,
      '',
      'Blocked: none',
      '',
      ...rest.filter((line) => line !== 'Blocked: none'),
    ].join('\n');

    expect(classesOf(text)).toContain(ShapeClasses.SECTION_ORDER);
  });

  test('a project with its own labels is held to them, not to the English ones', () => {
    const custom = {
      minimapColumns: ['N', 'Job', 'State'],
      status: {
        done: 'fin',
        doing: 'wip',
        waiting: 'hold',
        todo: 'new',
        blocked: 'stuck',
        dropped: 'drop',
      },
      labels: {
        blocked: 'Stuck by:',
        decisions: 'Choose',
        noBlocker: 'nil',
        noDecision: 'Nothing to choose.',
        recommend: 'I suggest **{x}**.',
      },
    };
    const text = [
      'All done.',
      '',
      '| N | Job | State |',
      '|---|---|---|',
      '| 1 | Build | fin |',
      '',
      'Stuck by: nil',
      '',
      'Choose',
      '',
      '1. Merge? I suggest **yes**.',
    ].join('\n');

    expect(classesOf(text, custom)).toEqual([]);
    expect(classesOf(GOOD, custom)).toContain(ShapeClasses.MINIMAP_MISSING);
  });

  // The one fixture with diacritics, in invented words: it holds the matching to the characters as written.
  const DIACRITICS = {
    minimapColumns: ['#', 'Tasko', 'Ŝtato'],
    status: {
      done: 'farita',
      doing: 'farata',
      waiting: 'atendas',
      todo: 'ankoraŭ ne',
      blocked: 'ĉesigita',
      dropped: 'forĵetita',
    },
    labels: {
      blocked: 'Ĉesigo:',
      decisions: 'Decidoj necesaj',
      noBlocker: 'neniu',
      noDecision: 'Nenio necesas.',
      recommend: 'Mi proponas **{x}**.',
    },
  };

  test('a label set with diacritics and its own recommend pattern is held to as written', () => {
    const reply = [
      'La kontrolo estas farita kaj la peto estas malfermita.',
      '',
      '| # | Tasko | Ŝtato |',
      '|---|---|---|',
      '| 1 | Kontrolo | farita |',
      '| 2 | Revizio | farata |',
      '',
      '**Ĉesigo:** neniu',
      '',
      'La kontrolo funkciis sur ĉi tiu branĉo.',
      '',
      '## Decidoj necesaj',
      '',
      '1. Kunfandi? Mi proponas **jes**.',
    ].join('\n');

    expect(classesOf(reply, DIACRITICS)).toEqual([]);
    expect(classesOf(reply.replace('Ĉesigo:', 'Blocked:'), DIACRITICS)).toContain(
      ShapeClasses.BLOCKED_MISSING,
    );
    expect(classesOf(reply.replace('farata', 'in progress'), DIACRITICS)).toContain(
      ShapeClasses.MINIMAP_STATUS,
    );
    expect(classesOf(reply.replace(' Mi proponas **jes**.', ''), DIACRITICS)).toContain(
      ShapeClasses.DECISIONS_NO_RECOMMENDATION,
    );
  });

  test('symbols in the owner own status words and labels are the shape, not an emoji fault', () => {
    const symbols = {
      ...DIACRITICS,
      status: {
        done: '✅ farita',
        doing: '◀ farata',
        waiting: '⏳ atendas',
        todo: '⬜ ankoraŭ ne',
        blocked: '⛔ ĉesigita',
        dropped: '❌ forĵetita',
      },
    };
    const reply = [
      'La kontrolo estas farita kaj la peto estas malfermita.',
      '',
      '| # | Tasko | Ŝtato |',
      '|---|---|---|',
      '| 1 | Kontrolo | ✅ farita |',
      '| 2 | Revizio | ◀ farata |',
      '| 3 | Eldono | ⏳ atendas |',
      '| 4 | Purigado | ⬜ ankoraŭ ne |',
      '| 5 | Malnova | ⛔ ĉesigita |',
      '| 6 | Provo | ❌ forĵetita |',
      '',
      'Ĉesigo: neniu',
      '',
      'La kontrolo funkciis sur ĉi tiu branĉo.',
      '',
      '## Decidoj necesaj',
      '',
      '1. Kunfandi? Mi proponas **jes**.',
    ].join('\n');

    expect(classesOf(reply, symbols)).toEqual([]);
    expect(classesOf(reply.replace('Revizio', 'Revizio 🚀'), symbols)).toEqual([
      ShapeClasses.EMOJI,
    ]);
  });

  test('fenced code is data: a table or heading inside it is not structure', () => {
    const text = `${GOOD}\n\n\`\`\`\n# not a heading\n| # | Task | Status |\n\`\`\``;

    expect(classesOf(text)).toEqual([]);
  });

  test('emoji, an all-caps phrase and a relative path are style faults, never structural', () => {
    const text = `${GOOD}\n\nThis is VERY IMPORTANT \u{1F680} see \`src/a.ts\`.`;
    const classes = classesOf(text);

    expect(classes).toEqual(
      expect.arrayContaining([
        ShapeClasses.EMOJI,
        ShapeClasses.SHOUTING,
        ShapeClasses.RELATIVE_PATH,
      ]),
    );
    expect(classes.some((name) => ShapeClasses.isStructural(name))).toBe(false);
    expect(classesOf(text, { absolutePaths: false })).not.toContain(ShapeClasses.RELATIVE_PATH);
    expect(classesOf(`${GOOD}\n\nThe IGNIS project and HTTP.`)).toEqual([]);
  });

  test('a short reply is exempt by default and checked when the owner sets 0', () => {
    const defaults = resolveOwnerView({ owner: OWNER_SCHEMA.parse(undefined) });

    expect(checkOwnerShape({ text: 'Done.', view: defaults })).toEqual({
      isChecked: false,
      classes: [],
    });
    expect(checkOwnerShape({ text: 'Done.', view: view() }).isChecked).toBe(true);
    expect(checkOwnerShape({ text: '   ', view: view() }).isChecked).toBe(false);
  });

  test('the stricter short-reply setting wins: a profile may lower the project, never raise it', () => {
    const owner = OWNER_SCHEMA.parse({ report: { shortReplyWords: 20 } });
    const profile = (shortReplyWords: number) => ({
      schemaVersion: 1 as const,
      address: { formality: 'neutral' },
      tone: 'neutral',
      reportDetail: 'tables',
      habits: { askBeforeReversible: false, proposeCommits: false },
      labels: {},
      shortReplyWords,
    });

    expect(resolveOwnerView({ owner, profile: profile(0) }).shortReplyWords).toBe(0);
    expect(resolveOwnerView({ owner, profile: profile(80) }).shortReplyWords).toBe(20);
  });
});

describe('the violation log', () => {
  const project = (): string => {
    const root = createProject({ files: {} });

    mkdirSync(join(root, '.agents/local'), { recursive: true });

    return root;
  };

  test('records the classes and the date, never the reply, and the last reply for the next prompt', () => {
    const root = project();

    recordReply({
      root,
      classes: [ShapeClasses.BLOCKED_MISSING],
      now: new Date('2026-10-25T10:00:00Z'),
    });
    recordReply({ root, classes: [], now: new Date('2026-10-25T10:01:00Z') });

    const log = readFileSync(join(root, '.agents/local/violations.jsonl'), 'utf8');

    expect(log.trim().split('\n')).toEqual(['{"date":"2026-10-25","classes":["blocked-missing"]}']);
    expect(readLastClasses({ root, now: new Date('2026-10-25T10:02:00Z').getTime() })).toEqual([]);
    recordReply({ root, classes: [ShapeClasses.EMOJI], now: new Date('2026-10-25T10:03:00Z') });
    expect(readLastClasses({ root, now: new Date('2026-10-25T10:04:00Z').getTime() })).toEqual([
      'emoji',
    ]);
  });

  test('a last reply older than 30 minutes is ignored', () => {
    const root = project();

    recordReply({ root, classes: [ShapeClasses.EMOJI], now: new Date('2026-10-25T10:00:00Z') });

    expect(readLastClasses({ root, now: new Date('2026-10-25T10:31:00Z').getTime() })).toEqual([]);
  });

  test('the notes are one file per session, bounded by age and by count, and the old one-file note goes', () => {
    const root = project();
    const notes = join(root, '.agents/local/cache/replies');
    const legacy = join(root, '.agents/local/last-reply.json');

    writeFileSync(legacy, '{"at":1,"classes":["emoji"]}\n');

    recordReply({ root, classes: ['emoji'], session: 'old' });

    const stale = new Date(Date.now() - 31 * 60 * 1000);

    utimesSync(join(notes, readdirSync(notes)[0] ?? ''), stale, stale);
    recordReply({ root, classes: [], session: 'new' });

    expect(existsSync(legacy)).toBe(false);
    expect(readdirSync(notes)).toHaveLength(1);
    expect(readdirSync(notes)[0]).toMatch(/^new-[0-9a-f]{8}\.json$/);

    for (let index = 0; index < 40; index += 1) {
      recordReply({ root, classes: [], session: `many-${index}` });
    }

    expect(readdirSync(notes).length).toBeLessThanOrEqual(32);
    expect(readdirSync(notes).some((name) => name.startsWith('many-39-'))).toBe(true);
  });

  test('ids that reduce to the same characters, or share a long prefix, keep separate notes', () => {
    const root = project();
    const long = 'x'.repeat(80);

    recordReply({ root, classes: ['emoji'], session: 'a/b' });
    recordReply({ root, classes: [], session: 'a_b' });
    recordReply({ root, classes: ['shouting'], session: `${long}1` });
    recordReply({ root, classes: [], session: `${long}2` });
    recordReply({ root, classes: ['emoji'], session: 'default' });
    recordReply({ root, classes: [] });

    expect(readLastClasses({ root, session: 'a/b' })).toEqual(['emoji']);
    expect(readLastClasses({ root, session: 'a_b' })).toEqual([]);
    expect(readLastClasses({ root, session: `${long}1` })).toEqual(['shouting']);
    expect(readLastClasses({ root, session: `${long}2` })).toEqual([]);
    expect(readLastClasses({ root, session: 'default' })).toEqual(['emoji']);
    expect(readLastClasses({ root })).toEqual([]);
  });

  test('a symlinked note folder is never written through', () => {
    const root = project();
    const outside = createProject({ files: { 'victim.txt': 'keep' } });

    mkdirSync(join(root, '.agents/local/cache'));
    symlinkSync(outside, join(root, '.agents/local/cache/replies'));
    recordReply({ root, classes: ['emoji'], session: 'a' });

    expect(readdirSync(outside)).toEqual(['victim.txt']);
    expect(readLastClasses({ root, session: 'a' })).toEqual([]);
  });

  test('counts by class across the log, skipping damaged lines and unknown classes', () => {
    const root = project();

    writeFileSync(
      join(root, '.agents/local/violations.jsonl'),
      [
        '{"date":"2026-10-24","classes":["emoji","blocked-missing"]}',
        'not json',
        '{"date":"2026-10-25","classes":["emoji","made-up"]}',
      ].join('\n'),
    );

    const counts = readViolationCounts({ root });

    expect(counts.replies).toBe(2);
    expect(counts.days).toBe(2);
    expect(counts.byClass.get('emoji')).toBe(2);
    expect(counts.byClass.has('made-up')).toBe(false);
  });

  test('nothing is written without a trusted .agents/local/, or through a symlinked file', () => {
    const none = createProject({ files: {} });
    const linked = project();
    const outside = createProject({ files: { 'victim.txt': 'keep' } });

    recordReply({ root: none, classes: ['emoji'] });
    expect(existsSync(join(none, '.agents/local/violations.jsonl'))).toBe(false);

    symlinkSync(join(outside, 'victim.txt'), join(linked, '.agents/local/violations.jsonl'));
    recordReply({ root: linked, classes: ['emoji'] });
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('keep');
  });
});

describe('checkOwnerShape does not reject a correct reply', () => {
  const clean = (text: string, change: Record<string, unknown> = {}): void =>
    expect(classesOf(text, change)).toEqual([]);

  test('a headline that begins with a label is still a headline', () => {
    clean(
      GOOD.replace(
        'The build passes and the pull request is open.',
        'Blocked: CI is down, so nothing merged.',
      ),
    );
    clean(
      GOOD.replace(
        'The build passes and the pull request is open.',
        'Decisions needed from you on one point.',
      ),
    );
  });

  test('the none string in its natural forms', () => {
    const none = (decisions: string) =>
      GOOD.replace('## Decisions needed\n\n1. Merge now? I recommend **yes**.', decisions);

    clean(none('Decisions needed: Nothing needed yet.'));
    clean(none('**Decisions needed:** Nothing needed yet.'));
    clean(none('## Decisions needed\n\nNothing needed yet.\n\nPing me if anything changes.'));
    clean(none('## Decisions needed\n\n*Nothing needed yet.*'));
    clean(none('## Decisions needed\n\nNothing needed yet'));
  });

  test('a person who asked for headline-only reports is held to the headline and the style', () => {
    const profileView = resolveOwnerView({
      owner: OWNER_SCHEMA.parse({ report: { shortReplyWords: 0 } }),
      profile: {
        schemaVersion: 1,
        address: { formality: 'neutral' },
        tone: 'neutral',
        reportDetail: 'headline',
        habits: { askBeforeReversible: false, proposeCommits: false },
        labels: {},
      },
    });

    expect(
      checkOwnerShape({ text: 'The build passes and the pull request is open.', view: profileView })
        .classes,
    ).toEqual([]);
  });

  test('abbreviations do not end a sentence', () => {
    clean(
      GOOD.replace(
        'The build passes and the pull request is open.',
        'Lint, tests etc. pass. The PR is open.',
      ),
    );
    clean(
      GOOD.replace(
        'The build passes and the pull request is open.',
        'Dr. Smith approved the change, e.g. the fix.',
      ),
    );
  });

  test('the Blocked line in the common markdown forms', () => {
    for (const form of [
      '*Blocked:* none',
      '__Blocked:__ none',
      '1. Blocked: none',
      '> Blocked: none',
      '| Blocked: | none |',
      '**Blocked:** none',
    ]) {
      clean(GOOD.replace('Blocked: none', form));
    }
  });

  test('the minimap with an extra column, an emphasised or annotated status, an escaped pipe', () => {
    clean(
      GOOD.replace('| # | Task | Status |', '| # | Task | Status | Note |').replace(
        '|---|------|--------|',
        '|---|---|---|---|',
      ),
    );
    clean(GOOD.replace('| 1 | Build | done |', '| 1 | Build | *done* |'));
    clean(GOOD.replace('| 1 | Build | done |', '| 1 | Build | done (PR #3) |'));
    clean(GOOD.replace('| 1 | Build | done |', '| 1 | a \\| b | done |'));
  });

  test('the recommendation without a closing full stop, or with a sentence after it', () => {
    clean(GOOD.replace('**yes**.', '**yes**'));
    clean(GOOD.replace('**yes**.', '**yes**. It is green.'));
    clean(
      GOOD.replace(
        '1. Merge now? I recommend **yes**.',
        '1. Merge now?\n   - a\n   - b\n   I recommend **a**.',
      ),
    );
  });

  test('a copyright sign, an arrow, a check mark and an acronym run are not style faults', () => {
    clean(`${GOOD}\n\nThe CI API JSON © ↔ ✔ HTTP GET passed.`.replace('\n\nThe', '\n\nThe'));
  });

  test('an unclosed fence does not hide the rest of the reply', () => {
    clean(`${GOOD}\n\n\`\`\`\ncode`.replace('## Decisions needed', '## Decisions needed'));
  });

  test('a very long decision item is checked in linear time', () => {
    const start = performance.now();

    classesOf(GOOD.replace('I recommend **yes**.', 'x '.repeat(100_000)), {
      labels: { ...OWNER_SCHEMA.parse(undefined).report.labels, recommend: '{x}.' },
    });
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

const DIACRITICS_FOR_FREE = {
  minimapColumns: ['#', 'Tasko', 'Stato'],
  status: {
    done: 'farita',
    doing: 'farata',
    waiting: 'atendas',
    todo: 'ankoraŭ ne',
    blocked: 'ĉesigita',
    dropped: 'forĵetita',
  },
  labels: {
    blocked: 'Ĉesigo:',
    decisions: 'Decidoj',
    noBlocker: 'neniu',
    noDecision: 'Nenio necesas.',
    recommend: 'Mi proponas **{x}**.',
  },
};

describe('the free label mode: a language with no label set, only the structure is checked', () => {
  const freeView = (opts: { language: string; change?: Record<string, unknown> }) =>
    resolveOwnerView({
      owner: OWNER_SCHEMA.parse({ report: { shortReplyWords: 0, ...opts.change } }),
      profile: PROFILE_SCHEMA.parse({ schemaVersion: 1, language: opts.language }),
    });
  const free = freeView({ language: 'eo' });
  const FREE_GOOD = [
    'La kontrolo estas farita.',
    '',
    '| # | Tasko | Stato |',
    '|---|---|---|',
    '| 1 | Kontrolo | iu ajn vorto |',
    '',
    '**Ĉesigo:** neniu',
    '',
    'Detaloj sekvas ĉi tie.',
    '',
    '## Decidoj',
    '',
    '1. Kunfandi? Mi proponas jes.',
  ].join('\n');
  const classesIn = (text: string) => checkOwnerShape({ text, view: free }).classes;

  test('the view is free for a language that is not English and has no set', () => {
    expect(free.labelMode).toBe('free');
    expect(freeView({ language: 'en-GB' }).labelMode).toBe('exact');
    expect(view().labelMode).toBe('exact');
  });

  test('a reply in the shape, in any words, has no fault; so has the English one', () => {
    expect(classesIn(FREE_GOOD)).toEqual([]);
    expect(classesIn(GOOD)).toEqual([]);
  });

  test('a set written for the language makes it exact; a set for another language does not', () => {
    const owner = (language: string) =>
      OWNER_SCHEMA.parse({ language, report: { shortReplyWords: 0, ...DIACRITICS_FOR_FREE } });
    const profile = PROFILE_SCHEMA.parse({ schemaVersion: 1, language: 'eo' });

    // The project's labels belong to its own language, English here: they do not reach an eo reader.
    expect(resolveOwnerView({ owner: owner('en'), profile }).labelMode).toBe('free');
    expect(resolveOwnerView({ owner: owner('eo'), profile }).labelMode).toBe('exact');
    expect(resolveOwnerView({ owner: owner('eo') }).labelMode).toBe('exact');
  });

  test('a missing table, blocker line or decisions section is still a fault', () => {
    expect(classesIn(FREE_GOOD.replace(/\| .*\n/g, ''))).toContain(ShapeClasses.MINIMAP_MISSING);
    expect(classesIn(FREE_GOOD.replace('**Ĉesigo:** neniu\n', ''))).toContain(
      ShapeClasses.BLOCKED_MISSING,
    );
    expect(
      classesIn(FREE_GOOD.replace('## Decidoj\n\n1. Kunfandi? Mi proponas jes.', '')),
    ).toContain(ShapeClasses.DECISIONS_MISSING);
  });

  test('the decisions are a numbered list or one short line, not a paragraph', () => {
    const head = FREE_GOOD.replace('1. Kunfandi? Mi proponas jes.', '');

    expect(classesIn(`${head}Nenio necesas.`)).toEqual([]);
    expect(classesIn(`${head}Unua linio de teksto.\nDua linio de teksto.`)).toContain(
      ShapeClasses.DECISIONS_MALFORMED,
    );
    expect(
      classesIn(
        FREE_GOOD.replace('## Decidoj\n\n1. Kunfandi? Mi proponas jes.', 'Decidoj: nenio necesas.'),
      ),
    ).toEqual([]);
  });

  test('the status words and the recommendation are not checked, the headline and the style still are', () => {
    expect(classesIn(FREE_GOOD.replace('iu ajn vorto', 'xyzzy'))).toEqual([]);
    expect(classesIn(FREE_GOOD.replace(' Mi proponas jes.', ''))).toEqual([]);
    expect(classesIn(FREE_GOOD.replace('La kontrolo estas farita.', '## Titolo'))).toContain(
      ShapeClasses.HEADLINE_NOT_SENTENCE,
    );
    expect(classesIn(`${FREE_GOOD}\n\nBone \u{1F680}.`)).toContain(ShapeClasses.EMOJI);
  });
});
