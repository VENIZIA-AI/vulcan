/**
 * Hands okf a project config the way `vulcan x` does (`VULCAN_CONFIG` + `VULCAN_PROJECT_ROOT`).
 * Missing sections are fine: the reader applies the same defaults the cli schema does.
 */
export const useProjectConfig = (opts: { root: string; config: object }): void => {
  process.env.VULCAN_CONFIG = JSON.stringify(opts.config);
  process.env.VULCAN_PROJECT_ROOT = opts.root;
};

/** Every test file that uses `useProjectConfig` registers this in its own `afterEach`. */
export const clearProjectConfig = (): void => {
  delete process.env.VULCAN_CONFIG;
  delete process.env.VULCAN_PROJECT_ROOT;
};
