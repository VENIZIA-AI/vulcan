/** Hands atlas a project config the way `vulcan x` does (`VULCAN_CONFIG` + `VULCAN_PROJECT_ROOT`). */
export const useAtlasProject = (opts: { root: string; config: object }): void => {
  process.env.VULCAN_CONFIG = JSON.stringify(opts.config);
  process.env.VULCAN_PROJECT_ROOT = opts.root;
};

/** Every test file that uses `useAtlasProject` registers this in its own `afterEach`. */
export const clearAtlasProject = (): void => {
  delete process.env.VULCAN_CONFIG;
  delete process.env.VULCAN_PROJECT_ROOT;
};
