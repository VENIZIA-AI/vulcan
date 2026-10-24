import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OWNER_SCHEMA,
  OwnerConstants,
  PROFILE_SCHEMA,
  profileIsIgnored,
  readProfile,
  renderOwnerShapeCard,
  renderProfileCard,
  resolveOwnerView,
  stricterEnforcement,
  writeProfile,
} from '../../owner/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

/** A label set in a language the framework does not ship: it is the person's, held in their profile. */
const FRENCH = {
  minimapColumns: ['n', 'Tache', 'Etat'],
  status: {
    done: 'fait',
    doing: 'en cours',
    waiting: 'en attente',
    todo: 'a faire',
    blocked: 'bloque',
    dropped: 'abandonne',
  },
  labels: {
    blocked: 'Bloque :',
    decisions: 'Decisions a prendre',
    noBlocker: 'aucun',
    noDecision: 'Rien a decider pour le moment.',
    recommend: 'Je recommande **{x}**.',
  },
};
const PROFILE = { schemaVersion: 1 };

describe('the owner block defaults', () => {
  test('are English, neutral and advise, with the whole shape', () => {
    const owner = OWNER_SCHEMA.parse(undefined);

    expect(owner.language).toBe('en');
    expect(owner.report.enforce).toBe('advise');
    expect(owner.report.shape).toEqual(['headline', 'minimap', 'blocked', 'detail', 'decisions']);
    expect(owner.report.minimapColumns).toEqual(['#', 'Task', 'Status']);
    expect(owner.report.status.doing).toBe('in progress');
    expect(owner.report.labels.noDecision).toBe('Nothing needed yet.');
    expect(owner.report.headlineMaxSentences).toBe(2);
    expect(owner.report.absolutePaths).toBe(true);
  });

  test('a project overrides single fields and keeps the rest', () => {
    const owner = OWNER_SCHEMA.parse({
      language: 'fr',
      report: { enforce: 'block', labels: FRENCH.labels, shape: ['headline', 'decisions'] },
    });

    expect(owner.language).toBe('fr');
    expect(owner.report.enforce).toBe('block');
    expect(owner.report.labels.blocked).toBe('Bloque :');
    expect(owner.report.status.done).toBe('done');
    expect(owner.report.shape).toEqual(['headline', 'decisions']);
  });

  test.each([
    { report: { enforce: 'sometimes' } },
    { report: { shape: ['headline', 'poem'] } },
    { report: { shape: [] } },
    {
      report: { labels: { ...OwnerConstants.DEFAULT_LABELS.labels, recommend: 'I recommend it.' } },
    },
    { report: { headlineMaxSentences: 0 } },
    { surprise: true },
  ])('rejects %j', (value) => {
    expect(OWNER_SCHEMA.safeParse(value).success).toBe(false);
  });
});

describe('the profile', () => {
  test('a minimal profile gets neutral defaults', () => {
    const profile = PROFILE_SCHEMA.parse(PROFILE);

    expect(profile.tone).toBe('neutral');
    expect(profile.address.formality).toBe('neutral');
    expect(profile.reportDetail).toBe('tables');
    expect(profile.habits).toEqual({ askBeforeReversible: false, proposeCommits: false });
    expect(profile.labels).toEqual({});
  });

  test('address takes any text, so no language is assumed', () => {
    const profile = PROFILE_SCHEMA.parse({
      ...PROFILE,
      address: { you: 'Tanaka-san', self: 'watashi', formality: 'formal' },
    });

    expect(profile.address).toEqual({ you: 'Tanaka-san', self: 'watashi', formality: 'formal' });
  });

  test.each([
    { schemaVersion: 2 },
    { ...PROFILE, tone: 'sarcastic' },
    { ...PROFILE, personality: 'extrovert' },
    {
      ...PROFILE,
      labels: { fr: { ...FRENCH, labels: { ...FRENCH.labels, recommend: 'no slot' } } },
    },
  ])('rejects %j', (value) => {
    expect(PROFILE_SCHEMA.safeParse(value).success).toBe(false);
  });

  test('read: absent is none, broken says what is wrong', () => {
    const root = createProject({ files: {} });

    expect(readProfile({ root })).toEqual({ ok: true, profile: undefined });

    mkdirSync(join(root, '.agents/local'), { recursive: true });
    writeFileSync(join(root, OwnerConstants.PROFILE_FILE), '{ nope');
    expect(readProfile({ root })).toEqual({
      ok: false,
      error: '.agents/local/profile.json is not valid JSON',
    });

    writeFileSync(
      join(root, OwnerConstants.PROFILE_FILE),
      JSON.stringify({ ...PROFILE, tone: 'x' }),
    );

    const read = readProfile({ root });

    expect(read.ok).toBe(false);
    expect(!read.ok && read.error).toContain('tone');
  });

  test('write refuses without a .gitignore that lists .agents/local/, and saves with mode 0600 with one', () => {
    const bare = createProject({ files: {} });
    const wrong = createProject({ files: { '.gitignore': 'node_modules/\n' } });
    const ready = createProject({ files: { '.gitignore': 'node_modules/\n.agents/local/\n' } });

    expect(profileIsIgnored({ root: bare })).toBe(false);
    expect(writeProfile({ root: bare, profile: PROFILE }).ok).toBe(false);
    expect(writeProfile({ root: wrong, profile: PROFILE }).ok).toBe(false);
    expect(existsSync(join(wrong, OwnerConstants.PROFILE_FILE))).toBe(false);
    expect(writeProfile({ root: ready, profile: PROFILE })).toEqual({ ok: true });
    expect(statSync(join(ready, OwnerConstants.PROFILE_FILE)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(ready, OwnerConstants.PROFILE_FILE), 'utf8')).toContain(
      '"schemaVersion": 1',
    );
  });

  test('write refuses an invalid profile before touching the disk', () => {
    const ready = createProject({ files: { '.gitignore': '.agents/local/\n' } });

    expect(writeProfile({ root: ready, profile: { ...PROFILE, tone: 'x' } }).ok).toBe(false);
    expect(existsSync(join(ready, OwnerConstants.PROFILE_FILE))).toBe(false);
  });
});

describe('resolveOwnerView', () => {
  const owner = OWNER_SCHEMA.parse(undefined);

  test('with no profile it is the project block and no personal settings', () => {
    const view = resolveOwnerView({ owner });

    expect(view.language).toBe('en');
    expect(view.labels.labels.blocked).toBe('Blocked:');
    expect(view.address).toBeUndefined();
    expect(view.tone).toBeUndefined();
  });

  test("a person with their own language and labels gets them, the shape stays the project's", () => {
    const projectOnlyHeadline = OWNER_SCHEMA.parse({
      report: { shape: ['headline', 'decisions'] },
    });
    const profile = PROFILE_SCHEMA.parse({ ...PROFILE, language: 'fr', labels: { fr: FRENCH } });
    const view = resolveOwnerView({ owner: projectOnlyHeadline, profile });

    expect(view.language).toBe('fr');
    expect(view.labels.labels.blocked).toBe('Bloque :');
    expect(view.shape).toEqual(['headline', 'decisions']);
  });

  test("a language with no label set of its own gets English, never the project's other language", () => {
    const french = OWNER_SCHEMA.parse({ language: 'fr', report: { labels: FRENCH.labels } });
    const german = PROFILE_SCHEMA.parse({ ...PROFILE, language: 'de' });

    expect(resolveOwnerView({ owner: french, profile: german }).labels.labels.blocked).toBe(
      'Blocked:',
    );
    expect(resolveOwnerView({ owner: french }).labels.labels.blocked).toBe('Bloque :');
  });

  test('enforce is the stricter of the project and the person, never looser', () => {
    expect(stricterEnforcement({ first: 'advise', second: 'block' })).toBe('block');
    expect(stricterEnforcement({ first: 'block', second: 'off' })).toBe('block');
    expect(stricterEnforcement({ first: 'off', second: undefined })).toBe('off');

    const strict = OWNER_SCHEMA.parse({ report: { enforce: 'block' } });
    const loose = PROFILE_SCHEMA.parse({ ...PROFILE, enforce: 'off' });

    expect(resolveOwnerView({ owner: strict, profile: loose }).enforce).toBe('block');
    expect(
      resolveOwnerView({ owner, profile: PROFILE_SCHEMA.parse({ ...PROFILE, enforce: 'block' }) })
        .enforce,
    ).toBe('block');
  });
});

describe('the cards', () => {
  const owner = OWNER_SCHEMA.parse(undefined);

  test('the shape card names every section, the labels and the status words, in the configured order', () => {
    const card = renderOwnerShapeCard({ view: resolveOwnerView({ owner }) }).join('\n');

    expect(card).toContain('## How to answer the owner');
    expect(card).toContain('`| # | Task | Status |`');
    expect(card).toContain('done, in progress, waiting, not started, blocked, dropped');
    expect(card).toContain('`Blocked:`');
    expect(card).toContain('`Nothing needed yet.`');
    expect(card.indexOf('headline')).toBeLessThan(card.indexOf('minimap') + card.indexOf('table'));
    expect(card).toContain('full absolute path');
  });

  test('enforce off prints no shape card; a shorter shape prints only its sections', () => {
    expect(
      renderOwnerShapeCard({
        view: resolveOwnerView({ owner: OWNER_SCHEMA.parse({ report: { enforce: 'off' } }) }),
      }),
    ).toEqual([]);

    const short = OWNER_SCHEMA.parse({ report: { shape: ['headline'], absolutePaths: false } });
    const card = renderOwnerShapeCard({ view: resolveOwnerView({ owner: short }) }).join('\n');

    expect(card).toContain('a headline');
    expect(card).not.toContain('Decisions needed');
    expect(card).not.toContain('absolute path');
  });

  test('the profile card is empty without a profile and short with one', () => {
    expect(renderProfileCard({ view: resolveOwnerView({ owner }) })).toEqual([]);

    const profile = PROFILE_SCHEMA.parse({
      ...PROFILE,
      language: 'fr',
      address: { you: 'Camille', self: 'moi', formality: 'informal' },
      tone: 'friendly',
      habits: { askBeforeReversible: true, proposeCommits: true },
      about: 'I like short answers.',
    });
    const card = renderProfileCard({ view: resolveOwnerView({ owner, profile }) }).join('\n');

    expect(card).toContain('Reply in fr.');
    expect(card).toContain('Address them as "Camille"');
    expect(card).toContain('Ask before a reversible choice.');
    expect(card).toContain('Propose commits.');
    expect(card).toContain('"I like short answers."');
    expect(card.split(/\s+/).length).toBeLessThan(90);
  });

  test('the free text on the card is cut, the file keeps it whole', () => {
    const long = 'x'.repeat(500);
    const profile = PROFILE_SCHEMA.parse({ ...PROFILE, about: long });
    const card = renderProfileCard({ view: resolveOwnerView({ owner, profile }) }).join('\n');

    expect(card).toContain('x'.repeat(OwnerConstants.CARD_ABOUT_MAX_CHARACTERS));
    expect(card).not.toContain('x'.repeat(OwnerConstants.CARD_ABOUT_MAX_CHARACTERS + 1));
  });
});
