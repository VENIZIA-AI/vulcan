import { OFFICIAL_PRESETS, officialIdOf } from '@venizia/vulcan-atlas';
import { promptSelect, promptText } from '../ui/index.ts';

const ANOTHER_PRESET = ':another-preset';

/** A preset a project recorded: what `--preset` takes back, the side it builds, what it is. */
export interface IKnownPreset {
  spec: string;
  side: string;
  summary: string;
}

/**
 * What a menu offers for `--preset`: the presets the project recorded, then the official ones it has
 * not used yet (the one list atlas answers `presets` from), then a text input for any other package
 * or `file:` path. null when the user cancelled.
 */
export const askPresetSpec = async (opts: { recorded: IKnownPreset[] }): Promise<string | null> => {
  const used = new Set(opts.recorded.map(entry => officialIdOf({ spec: entry.spec })));
  const picked = await promptSelect({
    message: 'Which preset?',
    choices: [
      ...opts.recorded.map(entry => ({
        value: entry.spec,
        label: entry.spec,
        hint: `${entry.side}: ${entry.summary}`,
      })),
      ...OFFICIAL_PRESETS.filter(entry => !used.has(entry.id)).map(entry => ({
        value: entry.id,
        label: entry.id,
        hint: `official, ${entry.side} (app or lib)`,
      })),
      { value: ANOTHER_PRESET, label: 'Another preset...', hint: 'a package name or file:<path>' },
    ],
  });

  if (picked !== ANOTHER_PRESET) {
    return picked;
  }

  return promptText({
    message: 'Preset (a package name, or file:<path>)',
    validate: value => (value.trim() === '' ? 'a package name, or file:<path>' : undefined),
  });
};
