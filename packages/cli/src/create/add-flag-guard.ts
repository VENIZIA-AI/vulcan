import { LayoutFolder } from '../common/layout-folder.ts';
import type { ILayout } from '../common/layout-folder.ts';
import { AddConstants, AppSides, CreateFlags } from './common/index.ts';
import type { TAppSide } from './common/index.ts';
import { ProjectNames, SIDE_FIELDS } from './names.ts';

/** What the flags of `add` leave unsaid. */
export class AddFlagGuard {
  /** The side the flags give away: a frontend flag, or only the backend folder; undefined when they do not say. */
  private static sideNamedBy(opts: { args: string[] }): TAppSide | undefined {
    const frontend = [CreateFlags.FRONTEND_DIR, CreateFlags.API, CreateFlags.NO_API].some((flag) =>
      opts.args.includes(flag),
    );
    const backend = opts.args.includes(CreateFlags.BACKEND_DIR);

    if (frontend === backend) {
      return undefined;
    }

    return frontend ? AppSides.FRONTEND : AppSides.BACKEND;
  }

  /**
   * What the command line already settles, checked before the preset is downloaded: without a terminal
   * to ask, a missing --app, a side folder neither given nor held by the config, or a frontend with
   * neither --api nor --no-api cannot be fixed by the download. The side is known from the flags when
   * they name it; a preset whose side only its package says is checked after the download.
   */
  static missingFlag(opts: { args: string[]; layout: ILayout }): string | undefined {
    const side = AddFlagGuard.sideNamedBy({ args: opts.args });

    if (ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.APP }) === undefined) {
      const kind = side === undefined ? '' : `${side} `;

      return `missing ${CreateFlags.APP} (Name of this ${kind}app) - names are never chosen for you`;
    }

    if (side === undefined) {
      return undefined;
    }

    const folder = SIDE_FIELDS[side];

    const listed = LayoutFolder.layoutFoldersOf({ value: opts.layout[side] });

    // One listed folder is the answer; none, or several, is for the flag to say.
    if (
      ProjectNames.readFlag({ args: opts.args, flag: folder.flag }) === undefined &&
      listed.length !== 1
    ) {
      return `missing ${folder.flag} (${folder.question}${listed.length > 1 ? `; ${LayoutFolder.listedNote({ folders: listed })}` : ''}) - names are never chosen for you`;
    }

    const hasApi = opts.args.includes(CreateFlags.API) || opts.args.includes(CreateFlags.NO_API);

    return side === AppSides.FRONTEND && !hasApi ? AddConstants.MISSING_API : undefined;
  }
}
