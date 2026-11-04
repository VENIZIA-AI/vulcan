import type { TConstValue } from '@/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IGNIS_ROOT } from '../ignis-root.helper';
import { buildRepositoryServer } from '../server.helper';

/** The projects a golden question runs against. */
export class GoldenProjects {
  static readonly IGNIS = 'ignis';
  static readonly ARDOR = 'ardor';
  static readonly VULCAN = 'vulcan';
  /** The small fixture project the mechanism tests use. */
  static readonly ACME = 'acme';

  /** IGNIS and ARDOR are checkouts beside this repository, or where `IGNIS_ROOT` and `ARDOR_ROOT` say; VULCAN is this one. */
  static rootOf(opts: { project: TGoldenProject }): string {
    const roots: Record<TGoldenProject, string> = {
      [GoldenProjects.IGNIS]: IGNIS_ROOT,
      [GoldenProjects.ARDOR]: process.env.ARDOR_ROOT ?? join(IGNIS_ROOT, '..', 'ardor'),
      [GoldenProjects.VULCAN]: join(__dirname, '../../../../..'),
      [GoldenProjects.ACME]: join(__dirname, '../fixtures/acme'),
    };

    return roots[opts.project];
  }

  /** A project is there when its checkout has the manifest atlas reads. A question about an absent one skips. */
  static isPresent(opts: { project: TGoldenProject }): boolean {
    return existsSync(
      join(GoldenProjects.rootOf({ project: opts.project }), '.agents', 'vulcan.manifest.json'),
    );
  }
}

export type TGoldenProject = TConstValue<typeof GoldenProjects>;

/** Where a question stands against what atlas serves. Only the first two are a passing state. */
export class GoldenVerdicts {
  /** Not marked open, and a served text holds every phrase. */
  static readonly ANSWERED = 'answered';
  /** Marked open, and no served text holds every phrase yet. */
  static readonly OPEN = 'open';
  /** Marked open, and a served text now holds every phrase: remove the mark. */
  static readonly STALE_OPEN = 'stale-open';
  /** Not marked open, and no served text holds every phrase any more. */
  static readonly REGRESSED = 'regressed';
}

export type TGoldenVerdict = TConstValue<typeof GoldenVerdicts>;

/**
 * One question an agent of a consuming app asks, with what an answer must say.
 * The tool call is the one an agent would make; `holds` are phrases a single served text must contain
 * for the question to count as answered.
 */
export interface IGoldenQuestion {
  id: string;
  /** The question as the agent has it, for the test title. */
  question: string;
  project: TGoldenProject;
  ask: { tool: string; args: Record<string, unknown> };
  /** For a `search` the served texts are the bodies of its top hits, each alone; otherwise the reply. */
  holds: string[];
  /** The improvement that answers it. Present while the question is open; removing it is part of that improvement. */
  closedBy?: number;
}

interface IToolReply {
  result?: { content?: { text: string }[] };
  error?: { message: string };
}

interface ISearchReply {
  hits?: { id: string }[];
}

interface IGetReply {
  body?: string;
}

export class GoldenRunner {
  /** How many hits of a `search` an agent is taken to read. */
  static readonly TOP_HITS = 5;

  private static readonly transports = new Map<
    TGoldenProject,
    ReturnType<typeof buildRepositoryServer>
  >();

  /** The text a tool answers with; a tool error is thrown, because a question that cannot be asked is a broken question. */
  static async callOf(opts: {
    project: TGoldenProject;
    tool: string;
    args: Record<string, unknown>;
  }): Promise<string> {
    const root = GoldenProjects.rootOf({ project: opts.project });
    const transport =
      GoldenRunner.transports.get(opts.project) ??
      buildRepositoryServer({ root, version: '0.0.0-golden' });

    GoldenRunner.transports.set(opts.project, transport);

    // A `cwd` is written relative to the project, because the checkout is somewhere else on each machine.
    const args =
      typeof opts.args.cwd === 'string'
        ? { ...opts.args, cwd: join(root, opts.args.cwd) }
        : opts.args;
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: opts.tool, arguments: args },
    });
    const result2 = await transport.handleLine({ line });
    const reply: IToolReply = JSON.parse(result2 ?? '{}');

    if (reply.error !== undefined) {
      throw new Error(`${opts.tool} failed: ${reply.error.message}`);
    }

    return (reply.result?.content ?? []).map((part) => part.text).join('\n');
  }

  /** What the agent reads: each of the top hits of a `search` read in full with `get`, or the one reply of any other tool. */
  static async servedOf(opts: { question: IGoldenQuestion }): Promise<string[]> {
    const { project, ask } = opts.question;
    const reply = await GoldenRunner.callOf({ project, tool: ask.tool, args: ask.args });

    if (ask.tool !== 'search') {
      return [reply];
    }

    const found: ISearchReply = JSON.parse(reply);
    const ids = (found.hits ?? []).slice(0, GoldenRunner.TOP_HITS).map((hit) => hit.id);

    return Promise.all(
      ids.map(async (id) => {
        const result = await GoldenRunner.callOf({
          project,
          tool: 'get',
          args: { id, maxChars: 20_000 },
        });
        const chunk: IGetReply = JSON.parse(result);

        return chunk.body ?? '';
      }),
    );
  }

  /** Whether one served text holds every phrase: facts spread over several texts are not an answer. */
  static holdsOf(opts: { served: string[]; holds: string[] }): boolean {
    return opts.served.some((text) => opts.holds.every((phrase) => text.includes(phrase)));
  }

  static async verdictOf(opts: { question: IGoldenQuestion }): Promise<TGoldenVerdict> {
    const served = await GoldenRunner.servedOf(opts);
    const answered = GoldenRunner.holdsOf({ served, holds: opts.question.holds });
    const open = opts.question.closedBy !== undefined;

    if (answered) {
      return open ? GoldenVerdicts.STALE_OPEN : GoldenVerdicts.ANSWERED;
    }

    return open ? GoldenVerdicts.OPEN : GoldenVerdicts.REGRESSED;
  }
}
