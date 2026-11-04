import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { BoardConstants } from './common/index.ts';
import { BoardAgentSetting } from './agent-setting.ts';
import { BOARD_AGENT, BOARD_AGENTS } from './schema.ts';
import type { TBoardAgentSetting } from './schema.ts';

export interface IBoardSettings {
  title: string;
  owner: string;
  logo?: string;
  key: string;
  shapes: Record<string, string>;
  /** The listed `board.agents` keys with no lane; empty when none is listed, and then every agent shows. */
  roster: string[];
  /** A helper to the lane it rolls into. */
  lanes: Record<string, string>;
  /** Why a setting was not used, for the note the command prints. */
  notes: string[];
}

/** What the project calls things on the board page: its manifest block, with the fallbacks that keep VULCAN neutral. */
export class BoardSettings {
  /**
   * The names for the page. The owner is `board.owner`, else `gitUser` (`git config user.name`), else `Owner`; the
   * title is `board.title`, else the project name and "Board"; the logo is `board.logo`, an SVG in the project, as a
   * `data:` URL, and none when it is not set, is missing, is too large or is not an SVG. Nothing here is a default of
   * any one organisation.
   */
  static resolve(opts: {
    manifest: unknown;
    gitUser: string | undefined;
    readLogo: (path: string) => string | undefined;
  }): IBoardSettings {
    const manifest = RecordValue.isRecord(opts.manifest) ? opts.manifest : {};
    const block = RecordValue.isRecord(manifest.board) ? manifest.board : {};
    const name =
      typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : 'Project';
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    const notes: string[] = [];
    const { shapes, roster, lanes, problem } = BoardSettings.agentsOf({ value: block.agents });
    const logoPath = text(block.logo);
    const logo = logoPath === undefined ? undefined : opts.readLogo(logoPath);

    if (problem !== undefined) {
      notes.push(`board.agents is not used: ${problem}`);
    }

    if (logoPath !== undefined && logo === undefined) {
      notes.push(`board.logo ${logoPath} is missing, over 100 KB or not an SVG: no logo`);
    }

    return {
      title: text(block.title) ?? `${name} Board`,
      owner: text(block.owner) ?? text(opts.gitUser) ?? BoardConstants.DEFAULT_OWNER,
      ...(logo === undefined ? {} : { logo }),
      key:
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'project',
      shapes,
      roster,
      lanes,
      notes,
    };
  }

  /** The faces, the roster and the lanes of `board.agents`. A value that is no face or object is skipped; a lane that cannot be honoured drops the whole block, with `problem` saying why. */
  private static agentsOf(opts: { value: unknown }): Pick<
    IBoardSettings,
    'shapes' | 'roster' | 'lanes'
  > & {
    problem?: string;
  } {
    const listed: Record<string, TBoardAgentSetting> = {};

    for (const [name, value] of Object.entries(
      RecordValue.isRecord(opts.value) ? opts.value : {},
    )) {
      const entry = BOARD_AGENT.safeParse(value);

      if (entry.success) {
        listed[name] = entry.data;
      }
    }

    const parsed = BOARD_AGENTS.safeParse(listed);

    if (!parsed.success) {
      return {
        shapes: {},
        roster: [],
        lanes: {},
        problem: parsed.error.issues[0]?.message ?? 'not valid',
      };
    }

    const shapes: Record<string, string> = {};
    const lanes: Record<string, string> = {};
    const roster: string[] = [];

    for (const [name, setting] of Object.entries(parsed.data)) {
      const shape = BoardAgentSetting.shapeOf({ setting });
      const lane = BoardAgentSetting.laneOf({ setting });

      if (shape !== undefined) {
        shapes[name] = shape;
      }

      if (lane === undefined) {
        roster.push(name);
      } else {
        lanes[name] = lane;
      }
    }

    return { shapes, roster, lanes };
  }

  /** `git config user.name` of the project, or `undefined`. */
  static gitUserOf(opts: { root: string }): string | undefined {
    const git = spawnSync('git', ['config', 'user.name'], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: 5000,
    });

    return git.status === 0 ? git.stdout.trim() : undefined;
  }

  /** `resolve` for the project at `root`: its manifest, the git user (read by `readGitUser`, by default from git), and the logo file. */
  static read(opts: { root: string; readGitUser?: () => string | undefined }): IBoardSettings {
    let manifest: unknown;

    try {
      manifest = JSON.parse(readFileSync(join(opts.root, BoardConstants.MANIFEST_FILE), 'utf8'));
    } catch {
      manifest = {};
    }

    return BoardSettings.resolve({
      manifest,
      gitUser: (opts.readGitUser ?? (() => BoardSettings.gitUserOf({ root: opts.root })))(),
      readLogo: (path) => BoardSettings.logoOf({ root: opts.root, path }),
    });
  }

  /** The SVG at `path` in the project as a `data:` URL; a picture in an `img` runs no script, whatever the file holds. */
  private static logoOf(opts: { root: string; path: string }): string | undefined {
    const file = join(opts.root, opts.path);

    try {
      if (!existsSync(file) || statSync(file).size > BoardConstants.LOGO_MAX_BYTES) {
        return undefined;
      }

      const svg = readFileSync(file);

      return /<svg[\s>]/i.test(svg.toString('utf8', 0, 2000))
        ? `data:image/svg+xml;base64,${svg.toString('base64')}`
        : undefined;
    } catch {
      return undefined;
    }
  }
}
