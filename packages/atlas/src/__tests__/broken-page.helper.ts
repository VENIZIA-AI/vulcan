import type { CapturedStderr } from './stderr.helper';

/** The fixture corpus holds one broken page, which every load of it skips and reports. */
export class BrokenPage {
  /** Claims that line, exactly `times` of it. */
  static claim(opts: { stderr: CapturedStderr; times?: number }): void {
    opts.stderr.claim({
      parts: [
        '[CorpusLoader-load] skipped document | corpus: wiki | path: broken.md',
        'invalid YAML frontmatter',
      ],
      times: opts.times,
    });
  }
}
