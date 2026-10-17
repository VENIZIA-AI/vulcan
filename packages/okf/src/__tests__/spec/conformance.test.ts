import { describe, expect, test } from 'bun:test';
import { checkBundle } from '../../spec/conformance.ts';
import { IssueSeverities } from '../../spec/common/index.ts';

const issuesOf = (opts: { files: Record<string, string> }) =>
  checkBundle({ files: Object.entries(opts.files).map(([path, text]) => ({ path, text })) });

const errorsOf = (opts: { files: Record<string, string> }) =>
  issuesOf(opts).filter(issue => issue.severity === IssueSeverities.ERROR);

const warningsOf = (opts: { files: Record<string, string> }) =>
  issuesOf(opts).filter(issue => issue.severity === IssueSeverities.WARNING);

describe('concepts (§4, §11.1, §11.2)', () => {
  test('a concept carrying only `type` is fully conformant', () => {
    expect(issuesOf({ files: { 'a.md': '---\ntype: Metric\n---\nbody' } })).toEqual([]);
  });

  test('no frontmatter is an error', () => {
    expect(errorsOf({ files: { 'a.md': '# no frontmatter' } }).map(issue => issue.rule)).toEqual([
      '§11.1',
    ]);
  });

  test('unparseable YAML is an error that names the file', () => {
    const [issue] = errorsOf({ files: { 'x/a.md': '---\ntype: [unclosed\n---\n' } });

    expect(issue.rule).toBe('§11.1');
    expect(issue.file).toBe('x/a.md');
  });

  test('a nested `type` key does not satisfy the top-level one', () => {
    const text = '---\ntitle: A\nsources:\n  - resource: /b.md\n    type: Doc\n---\n';

    expect(errorsOf({ files: { 'a.md': text } }).map(issue => issue.rule)).toEqual(['§11.2']);
  });

  test('an empty `type` is an error', () => {
    expect(
      errorsOf({ files: { 'a.md': '---\ntype: ""\n---\n' } }).map(issue => issue.rule),
    ).toEqual(['§11.2']);
  });

  test('CRLF line endings parse like LF', () => {
    expect(issuesOf({ files: { 'a.md': '---\r\ntype: Metric\r\n---\r\nbody\r\n' } })).toEqual([]);
  });

  test('unknown types, unknown keys and missing optional fields are never rejected', () => {
    expect(
      issuesOf({ files: { 'a.md': '---\ntype: Brand New Kind\nx_custom: 1\n---\n' } }),
    ).toEqual([]);
  });

  test('broken links are tolerated', () => {
    expect(issuesOf({ files: { 'a.md': '---\ntype: T\n---\nsee [x](/missing.md)' } })).toEqual([]);
  });
});

describe('index.md (§8, §12)', () => {
  test('a root index may carry only okf_version', () => {
    expect(issuesOf({ files: { 'index.md': '---\nokf_version: "0.2"\n---\n# Index' } })).toEqual(
      [],
    );
  });

  test('any other key in the root index is an error', () => {
    const errors = errorsOf({
      files: { 'index.md': '---\nokf_version: "0.2"\ntitle: Index\n---\n' },
    });

    expect(errors.map(issue => issue.rule)).toEqual(['§8']);
    expect(errors[0].message).toContain('title');
  });

  test('a nested index carries no frontmatter at all', () => {
    expect(
      errorsOf({ files: { 'x/index.md': '---\nokf_version: "0.2"\n---\n' } }).map(
        issue => issue.rule,
      ),
    ).toEqual(['§8']);
  });

  test('an older okf_version is a warning, never a rejection (best effort)', () => {
    const files = { 'index.md': '---\nokf_version: "0.1"\n---\n' };

    expect(errorsOf({ files })).toEqual([]);
    expect(warningsOf({ files }).map(issue => issue.rule)).toEqual(['§12']);
  });
});

describe('log.md (§9)', () => {
  test('date headings newest first are conformant', () => {
    expect(
      issuesOf({
        files: { 'log.md': '# Log\n\n## 2026-10-16\n\n**Update** x\n\n## 2026-10-02\n\ny' },
      }),
    ).toEqual([]);
  });

  test('text after the date is tolerated (the spec is silent on it)', () => {
    expect(
      issuesOf({ files: { 'log.md': '## 2026-10-16 - knowledge-sync (delta): 3 fixes\n' } }),
    ).toEqual([]);
  });

  test('a heading that is not a date is an error', () => {
    expect(
      errorsOf({ files: { 'log.md': '## Recent changes\n' } }).map(issue => issue.rule),
    ).toEqual(['§9']);
  });

  test('an impossible date is an error', () => {
    expect(errorsOf({ files: { 'log.md': '## 2026-02-30\n' } }).map(issue => issue.rule)).toEqual([
      '§9',
    ]);
  });

  test('oldest first is an error', () => {
    expect(
      errorsOf({ files: { 'log.md': '## 2026-01-01\n\n## 2026-02-01\n' } }).map(
        issue => issue.rule,
      ),
    ).toEqual(['§9']);
  });
});

describe('trust and lifecycle fields (§5, §7) - soft guidance, warnings only', () => {
  const concept = (frontmatter: string) => ({
    files: { 'a.md': `---\ntype: T\n${frontmatter}\n---\n` },
  });

  test('an unknown status', () => {
    expect(warningsOf(concept('status: archived')).map(issue => issue.rule)).toEqual(['§5.4']);
  });

  test('a date where a datetime with offset is required', () => {
    expect(warningsOf(concept('stale_after: 2026-12-31')).map(issue => issue.rule)).toEqual(['§5']);
  });

  test('a source without resource', () => {
    expect(warningsOf(concept('sources:\n  - title: A')).map(issue => issue.rule)).toEqual([
      '§5.1',
    ]);
  });

  test('an actor without a known prefix', () => {
    expect(warningsOf(concept('generated:\n  by: ahormati')).map(issue => issue.rule)).toEqual([
      '§7',
    ]);
  });

  test('a bare verified mapping is one verification event', () => {
    expect(
      issuesOf(concept('verified:\n  by: human:ahormati\n  at: 2026-06-30T14:00:00Z')),
    ).toEqual([]);
  });

  test('well-formed v0.2 trust fields', () => {
    const fields =
      'status: draft\ngenerated:\n  by: okf-gen/0.2\n  at: 2026-06-30T14:00:00+07:00\nsources:\n  - resource: https://x.dev\n    last_modified: 2026-06-01T00:00:00Z';

    expect(issuesOf(concept(fields))).toEqual([]);
  });
});
