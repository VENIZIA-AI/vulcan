/**
 * Hands atlas a project manifest the way `vulcan atlas` or `vulcan okf` does (`VULCAN_MANIFEST` + `VULCAN_PROJECT_ROOT`).
 * `schemaVersion` is filled in; every other section takes the reader's defaults when absent.
 */
export const useAtlasProject = (opts: { root: string; manifest: object }): void => {
  process.env.VULCAN_MANIFEST = JSON.stringify({ schemaVersion: 1, ...opts.manifest });
  process.env.VULCAN_PROJECT_ROOT = opts.root;
};

/** Every test file that uses `useAtlasProject` registers this in its own `afterEach`. */
export const clearAtlasProject = (): void => {
  delete process.env.VULCAN_MANIFEST;
  delete process.env.VULCAN_PROJECT_ROOT;
};
