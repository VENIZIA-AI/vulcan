import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTheme, Theme } from '../../visualize/theme.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const projectWith = (manifest: string | undefined): string => {
  const root = mkdtempSync(join(tmpdir(), 'visualize-theme-'));

  roots.push(root);

  if (manifest !== undefined) {
    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(join(root, '.agents', 'vulcan.manifest.json'), manifest);
  }

  return root;
};

const palettes = (opts: { accent: string; accentDark?: string; accentText?: string }) => {
  const result = ProjectTheme.resolve({ spec: opts });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.theme;
};

describe('the project colour: which colour a page takes (C10)', () => {
  test('the spec wins, then the project, then the neutral default', () => {
    const spec = { accent: '#0277bd', accentText: '#01579b' };
    const project = { accent: '#8a5a20', accentDark: '#dead6a' };
    const fromSpec = ProjectTheme.resolve({ spec, project });
    const fromProject = ProjectTheme.resolve({ project });
    const neither = ProjectTheme.resolve({});

    expect(fromSpec.ok && fromSpec.theme.source).toBe('spec');
    expect(fromProject.ok && fromProject.theme.source).toBe('project');
    expect(neither.ok && neither.theme.source).toBe('default');
    expect(fromSpec.ok && fromSpec.theme.light.accent).toBe('#01579b');
    expect(fromProject.ok && fromProject.theme.light.accent).toBe('#8a5a20');
    expect(neither.ok && neither.theme.light.accent).toBe(ProjectTheme.DEFAULT.accent);
  });

  test('the default is the venizia bronze and passes on every ground; slate is a preset, not the default', () => {
    const theme = palettes(ProjectTheme.DEFAULT);

    expect(
      Theme.contrastOf({ foreground: theme.light.accent, background: theme.light.bg }),
    ).toBeGreaterThan(4.5);
    expect(
      Theme.contrastOf({ foreground: theme.dark.accent, background: theme.dark.bg }),
    ).toBeGreaterThan(7);
    expect(ProjectTheme.tokensCss({ theme }).toLowerCase()).toMatch(/8a5a20/);
    expect(ProjectTheme.tokensCss({ theme }).toLowerCase()).toMatch(/dead6a/);
    expect(ProjectTheme.tokensCss({ theme }).toLowerCase()).not.toMatch(/3f5266|9fb4cc/);
  });

  test('a colour that is not six hex digits is refused and named', () => {
    const result = ProjectTheme.resolve({ spec: { accent: 'red' } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toContain("accent 'red'");
  });
});

describe('the contrast checks: marks, text and fills (C11)', () => {
  test('the three repo colours pass: VULCAN as given, ARDOR with its deeper text colour', () => {
    expect(ProjectTheme.resolve({ spec: { accent: '#8a5a20', accentDark: '#dead6a' } }).ok).toBe(
      true,
    );
    expect(
      ProjectTheme.resolve({
        spec: { accent: '#0277bd', accentDark: '#38bdf8', accentText: '#01579b' },
      }).ok,
    ).toBe(true);
  });

  test('#af5f5f is refused as text on a soft panel and says the ratio, and an accentText makes it pass', () => {
    const refused = ProjectTheme.resolve({ spec: { accent: '#af5f5f', accentDark: '#c98a8a' } });

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problems.join('\n')).toMatch(
      /accent #af5f5f as text on .*:1; text needs 4\.5:1 - give a darker accentText/,
    );

    const accepted = ProjectTheme.resolve({
      spec: { accent: '#af5f5f', accentDark: '#c98a8a', accentText: '#8f3f3f' },
    });

    expect(accepted.ok).toBe(true);
  });

  test('a colour is never swapped: a failing accentText is reported as it was given', () => {
    const result = ProjectTheme.resolve({ spec: { accent: '#0277bd', accentText: '#7fbce8' } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join('\n')).toContain('accentText #7fbce8');
  });

  test('every text pair of the palettes passes 4.5 to 1 and the accent mark passes 3 to 1, in light and dark, for the three repos', () => {
    for (const input of [
      { accent: '#8a5a20', accentDark: '#dead6a' },
      { accent: '#0277bd', accentDark: '#38bdf8', accentText: '#01579b' },
      { accent: '#af5f5f', accentDark: '#c98a8a', accentText: '#8f3f3f' },
    ]) {
      const theme = palettes(input);

      for (const [name, palette] of [
        ['light', theme.light],
        ['dark', theme.dark],
      ] as const) {
        for (const ground of [palette.bg, palette.bgSoft, palette.accentSoft]) {
          expect(
            Theme.contrastOf({ foreground: palette.ink, background: ground }),
            `${name} ink ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.body, background: ground }),
            `${name} body ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.muted, background: ground }),
            `${name} muted ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.accent, background: ground }),
            `${name} accent ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        expect(
          Theme.contrastOf({ foreground: palette.accentInk, background: palette.accent }),
        ).toBeGreaterThanOrEqual(3);

        for (const slab of [palette.slab, palette.slab2, palette.slab3]) {
          expect(
            Theme.contrastOf({ foreground: palette.slabInk, background: slab }),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.slabBody, background: slab }),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.slabMuted, background: slab }),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            Theme.contrastOf({ foreground: palette.hot, background: slab }),
          ).toBeGreaterThanOrEqual(4.5);
        }

        expect(
          Theme.contrastOf({ foreground: palette.hotInk, background: palette.hot }),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('the text on an accent fill is white or near black, whichever passes', () => {
    expect(ProjectTheme.inkOn({ fill: '#8a5a20' })).toBe('#ffffff');
    expect(ProjectTheme.inkOn({ fill: '#dead6a' })).toBe('#0e0e0f');
  });
});

describe('the dark value (C12)', () => {
  test('with only a light accent the dark value is mixed toward white until it passes, and the derived value is reported', () => {
    const theme = palettes({ accent: '#0277bd', accentText: '#01579b' });

    expect(theme.dark.accent).not.toBe('#0277bd');
    expect(theme.notes.join(' ')).toContain(`accentDark ${theme.dark.accent} derived from #0277bd`);
    expect(
      Theme.contrastOf({ foreground: theme.dark.accent, background: theme.dark.bg }),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('a very dark accent still gets a dark value that reads on every dark ground and on the slab', () => {
    const theme = palettes({ accent: '#10243a' });

    for (const ground of [theme.dark.bg, theme.dark.bgSoft, theme.dark.slab, theme.dark.slab3]) {
      expect(
        Theme.contrastOf({ foreground: theme.dark.accent, background: ground }),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a given dark value is checked, not trusted', () => {
    const result = ProjectTheme.resolve({ spec: { accent: '#8a5a20', accentDark: '#33291a' } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join('\n')).toContain('accentDark #33291a');
  });
});

describe('state colours are separate from the accent (C13)', () => {
  test('an accent close in hue to the blocked red or the done green warns, and others do not', () => {
    const red = palettes({ accent: '#af5f5f', accentDark: '#c98a8a', accentText: '#8f3f3f' });
    const green = palettes({ accent: '#1f6f3a', accentDark: '#6fd18d' });
    const blue = palettes({ accent: '#0277bd', accentDark: '#38bdf8', accentText: '#01579b' });

    expect(red.warnings.join(' ')).toContain("'blocked'");
    expect(green.warnings.join(' ')).toContain("'done'");
    expect(blue.warnings).toEqual([]);
  });
});

describe('the token blocks', () => {
  test('light on :root, the system dark setting unless the page is set to light, then an explicit dark, with the same tokens in each', () => {
    const css = ProjectTheme.tokensCss({
      theme: palettes({ accent: '#8a5a20', accentDark: '#dead6a' }),
    });
    const [light, system, explicit] = css.split('\n');

    expect(light).toStartWith(':root{');
    expect(system).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme=light])');
    expect(explicit).toStartWith(':root[data-theme=dark]{');

    const names = (block: string): string[] =>
      [...block.matchAll(/--[a-z0-9-]+(?=:)/g)].map((match) => match[0]);

    expect(names(system).sort()).toEqual(names(light).sort());
    expect(names(explicit).sort()).toEqual(names(light).sort());
    expect(light).toContain('--accent:#8a5a20');
    expect(explicit).toContain('--accent:#dead6a');
  });
});

describe('the manifest theme is read from the folder the command runs in (C14)', () => {
  test('a manifest with a theme gives it; a missing file or no theme gives nothing', () => {
    const withTheme = projectWith(
      JSON.stringify({ schemaVersion: 2, theme: { accent: '#8a5a20', accentDark: '#dead6a' } }),
    );

    expect(ProjectTheme.readManifestTheme({ root: withTheme })).toEqual({
      theme: { accent: '#8a5a20', accentDark: '#dead6a' },
    });
    expect(
      ProjectTheme.readManifestTheme({ root: projectWith(JSON.stringify({ schemaVersion: 2 })) }),
    ).toEqual({});
    expect(ProjectTheme.readManifestTheme({ root: projectWith(undefined) })).toEqual({});
  });

  test('a manifest that is a symlink, or sits in a symlinked folder, is not read', () => {
    const real = projectWith(JSON.stringify({ theme: { accent: '#8a5a20' } }));
    const linkedFile = projectWith(undefined);
    const linkedFolder = projectWith(undefined);

    mkdirSync(join(linkedFile, '.agents'), { recursive: true });
    symlinkSync(
      join(real, '.agents', 'vulcan.manifest.json'),
      join(linkedFile, '.agents', 'vulcan.manifest.json'),
    );
    symlinkSync(join(real, '.agents'), join(linkedFolder, '.agents'));

    expect(ProjectTheme.readManifestTheme({ root: real }).theme?.accent).toBe('#8a5a20');
    expect(ProjectTheme.readManifestTheme({ root: linkedFile })).toEqual({});
    expect(ProjectTheme.readManifestTheme({ root: linkedFolder })).toEqual({});
  });

  test('a broken manifest or a bad theme falls back to the default colour with a warning, and nothing is thrown', () => {
    expect(ProjectTheme.readManifestTheme({ root: projectWith('{ not json') }).warning).toContain(
      'not valid JSON',
    );
    expect(
      ProjectTheme.readManifestTheme({ root: projectWith(JSON.stringify({ theme: 'red' })) })
        .warning,
    ).toContain('not an object');
    expect(
      ProjectTheme.readManifestTheme({
        root: projectWith(JSON.stringify({ theme: { accent: 'red' } })),
      }).warning,
    ).toContain('hex accent');
  });
});
