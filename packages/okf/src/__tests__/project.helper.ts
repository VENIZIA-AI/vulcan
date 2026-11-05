/** The tokens of both modes that the explorer reads from the manifest; the values are the test's own. */
const TOKENS = {
  ground: '#f0f0f0',
  bg: '#fafafa',
  line: '#0000001a',
  ink: '#101010',
  muted: '#666666',
  'accent-text': '#8a5a20',
  'accent-ink': '#ffffff',
};

export const TEST_MANIFEST = {
  theme: {
    tokens: {
      light: TOKENS,
      dark: {
        ...TOKENS,
        ground: '#121214',
        bg: '#1b1b1b',
        ink: '#fefefe',
        'accent-text': '#dead6a',
      },
    },
  },
};

/**
 * Hands okf a project config the way `vulcan x` does (`VULCAN_CONFIG` + `VULCAN_PROJECT_ROOT`, and the
 * manifest in `VULCAN_MANIFEST`). Missing sections are fine: the reader applies the same defaults the cli schema does.
 */
export const useProjectConfig = (opts: {
  root: string;
  config: object;
  manifest?: object;
}): void => {
  process.env.VULCAN_CONFIG = JSON.stringify(opts.config);
  process.env.VULCAN_PROJECT_ROOT = opts.root;
  process.env.VULCAN_MANIFEST = JSON.stringify(opts.manifest ?? TEST_MANIFEST);
};

/** Every test file that uses `useProjectConfig` registers this in its own `afterEach`. */
export const clearProjectConfig = (): void => {
  delete process.env.VULCAN_CONFIG;
  delete process.env.VULCAN_PROJECT_ROOT;
  delete process.env.VULCAN_MANIFEST;
};
