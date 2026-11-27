import { OFFICIAL_PRESETS, OfficialPresets } from '@venizia/vulcan-atlas';
import type { IOfficialPreset } from '@venizia/vulcan-atlas';
import { LibraryTypes, PackageTypes } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { TerminalCapability, TerminalPrompt } from '../ui/index.ts';
import { AddKinds } from './common/index.ts';
import type { ILocatedPreset, TAddKind } from './common/index.ts';
import { ProjectNames } from './names.ts';

/** The kinds `add` offers for a preset: their commands, why one is missing, and the question that picks one. */
export class AddKindRegistry {
  /** The commands a project can run for this preset: what `add` prints when it is not told what to create. */
  static kindCommands(opts: { presetValue: string }): string[] {
    return AddKinds.ORDER.map(
      (kind) =>
        `bun node_modules/.bin/vulcan package add --preset ${opts.presetValue} ${AddKinds.TABLE[kind].flag} <name>`,
    );
  }

  /** The kinds a located preset makes: always an app, a library kind only when its file is there. */
  static kindsOffered(opts: { located: ILocatedPreset }): TAddKind[] {
    const hasFile: Record<TAddKind, boolean> = {
      [PackageTypes.APP]: true,
      [LibraryTypes.LIB]: opts.located.libFile !== undefined,
      [LibraryTypes.SHARED]: opts.located.sharedFile !== undefined,
    };

    return AddKinds.ORDER.filter((kind) => hasFile[kind]);
  }

  /**
   * Why a preset cannot make a shared package, and where one can be had: the presets this project recorded with a
   * shared kind, then the official ones that have it. Nothing is invented: with none known it says so.
   */
  static noSharedKindMessage(opts: {
    located: ILocatedPreset;
    recorded: TResolvedConfig['presets'];
    name: string;
    official?: IOfficialPreset[];
  }): string {
    const { official = OFFICIAL_PRESETS } = opts;
    const recorded = (opts.recorded ?? []).filter((preset) => preset.shared !== undefined);
    const known = [
      ...recorded.map((preset) => preset.spec),
      ...official
        .filter((preset) => preset.shared !== undefined)
        .map((preset) => preset.id)
        .filter(
          (id) => !recorded.some((preset) => OfficialPresets.idOf({ spec: preset.spec }) === id),
        ),
    ];
    const commands = known.map(
      (spec) =>
        `bun node_modules/.bin/vulcan package add --preset ${spec} ${AddKinds.TABLE[LibraryTypes.SHARED].flag} ${opts.name}`,
    );

    return `preset ${opts.located.packageName} has no shared kind (it makes: ${AddKindRegistry.kindsOffered({ located: opts.located }).join(' and ')}); ${
      commands.length === 0
        ? 'no preset known to this project or to the official list has one'
        : `a preset with one: run ${commands.join(' or ')}`
    }`;
  }

  /** The terminal asks which kind, listing only what the preset offers; end of input stops the command. */
  static async askKind(opts: { offered: TAddKind[] }): Promise<TAddKind | undefined> {
    if (TerminalCapability.menusAvailable()) {
      const picked = await TerminalPrompt.promptSelect({
        message: 'What do you want to create?',
        choices: opts.offered.map((kind) => ({
          value: kind,
          label: kind,
          hint: AddKinds.TABLE[kind].hint,
        })),
      });

      return opts.offered.find((kind) => kind === picked);
    }

    for (;;) {
      const answer = ProjectNames.askWithPrompt({
        question: `What do you want to create? (${opts.offered.join(', ')})`,
      });

      if (answer === null) {
        return undefined;
      }

      const chosen = opts.offered.find((kind) => kind === answer.trim());

      if (chosen !== undefined) {
        return chosen;
      }
    }
  }
}
