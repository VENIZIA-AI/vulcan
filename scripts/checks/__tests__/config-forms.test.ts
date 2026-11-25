import { describe, expect, test } from 'bun:test';
import { ConfigForms } from '../config-forms.ts';

const scan = (text: string, file = 'docs/wiki/content/references/x.md') =>
  ConfigForms.scan({ files: [{ file, text }] });
const block = (body: string): string => `\`\`\`ts\n${body}\n\`\`\`\n`;

describe('the config shown in the docs is in the groups', () => {
  test('a sample in the flat shape is found, with the line of its fence', () => {
    const hits = scan(
      `text\n\n${block("export default {\n  agents: ['claude'],\n  rules: {},\n};")}`,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 4, text: 'a config sample in the flat shape' });
  });

  test('a sample in the groups, and a block that is not a config, are not', () => {
    expect(scan(block("export default {\n  agent: { list: ['claude'] },\n};"))).toEqual([]);
    expect(scan(block('const a = { agents: [] };'))).toEqual([]);
  });

  test.each([
    ['`events.log`', 'board.events.log'],
    ['`local.tmp`', 'common.local.tmp'],
    ['`okf.contents.files`', 'knowledge.okf.contents.files'],
    ['`owner.language`', 'agent.owner.language'],
    ['`doctor.layout`', 'check.layout'],
  ])('%s is the flat path of %s', (text, key) => {
    const hits = scan(`The key ${text} sets it.`);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.reason).toContain(`\`${key}\``);
  });

  test.each([
    '`board.events.log`',
    '`common.local.tmp`',
    '`rules.md`',
    '`agent.rules`',
    '`events`',
  ])('%s is not a flat path', (text) => {
    expect(scan(`The key ${text} sets it.`)).toEqual([]);
  });

  test('a flat key named between escaped backticks in a source string is found, a test is not read', () => {
    const text = 'message: `set \\`events.log\\` and \\`board.events.log\\``';
    const hits = scan(text, 'packages/cli/src/doctor/checks.ts');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      text: '`events.log`',
      reason: 'the key is `board.events.log`',
    });
    expect(scan(text, 'packages/cli/src/__tests__/doctor/checks.test.ts')).toEqual([]);
  });

  test('a flat key in plain prose, with no backticks, is found; a domain is not', () => {
    const hits = scan('Turn on events.log to see it, and read claude.ai for the rest.');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      text: '`events.log`',
      reason: 'the key is `board.events.log`',
    });
  });

  test('the changelogs, which keep the old words, are not read', () => {
    expect(scan('`events.log`', 'docs/wiki/content/changelogs/2026-10-01-x.md')).toEqual([]);
  });

  test('the words that look like a flat key and are not one are pinned', () => {
    expect(ConfigForms.NOT_CONFIG).toEqual([
      { file: 'docs/wiki/content/references/presets.md', token: 'presets.app' },
      { file: 'docs/wiki/content/references/presets.md', token: 'presets.lib' },
      { file: 'docs/wiki/content/references/presets.md', token: 'presets.shared' },
      { file: 'docs/wiki/content/references/presets.md', token: 'presets.files' },
      { file: 'docs/wiki/content/references/commands/sync.md', token: 'rules.base' },
    ]);
    expect(
      scan(
        'A package with `presets.lib` and the `rules.base` hashes.',
        'docs/wiki/content/references/presets.md',
      ),
    ).toHaveLength(1);
  });

  test('the tracked wiki, base texts and READMEs show no flat config', () => {
    expect(ConfigForms.scan({ files: ConfigForms.tracked() })).toEqual([]);
  });
});
