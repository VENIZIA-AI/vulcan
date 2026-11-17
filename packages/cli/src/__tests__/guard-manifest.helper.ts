/**
 * The committed manifest a hook reads for what the project set for the guards (`vulcan sync` renders it from
 * the config), so a test gives a hook the manifest it would find and no config at all.
 */
export const GUARD_MANIFEST_FILE = '.agents/vulcan.manifest.json';

export const guardManifest = (opts: { guard: Record<string, unknown> }): string =>
  JSON.stringify({ schemaVersion: 1, guard: opts.guard });
