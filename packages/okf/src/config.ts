/**
 * config.ts - the ONLY repo-specific configuration for the OKF knowledge tooling.
 *
 * Everything that knows the shape of THIS repository lives here: paths, denylists,
 * section order/labels, and the coverage axes. Porting the bundle to another repo
 * means editing this file; the scope folders, lib.ts and viz/ stay untouched.
 *
 * Renderers themselves are code, not config - they live in the RENDERERS registry in
 * generate/renderers.ts and read their paths from here.
 */
import { resolve } from 'node:path';

import type { IVizCopy, TLocale } from './viz/common/index.ts';

// The project the tooling reads: the directory it runs in, as every VULCAN tool.
export const REPO = process.cwd();
export const BUNDLE = resolve(REPO, '.agents/knowledge');

/** Directories never walked when scanning source. */
export const PRUNE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  '.cache',
  '.vitepress',
  '.claude',
  '__tests__',
]);

export const PATHS = {
  packages: resolve(REPO, 'packages'),
  examples: resolve(REPO, 'examples'),
  docs: resolve(REPO, 'docs/wiki'),
  coreComponents: resolve(REPO, 'packages/core-server/src/components'),
  coreBindings: resolve(REPO, 'packages/kernel/src/common/bindings.ts'),
  helpersModules: resolve(REPO, 'packages/helpers/src/modules'),
  helpersUtilities: resolve(REPO, 'packages/helpers/src/utilities'),
  makefile: resolve(REPO, 'Makefile'),
} as const;

/**
 * Scaffold or non-concept directories. Empty today - every packages/* and examples/*
 * dir is a real artifact that earns a concept. Add names here rather than special-casing
 * them in the renderers.
 */
export const PACKAGE_DENYLIST = new Set<string>([]);
export const EXAMPLE_DENYLIST = new Set<string>([]);

/** Bundle sections, in display order (viz + index). Unknown sections sort in after these. */
export const SECTION_ORDER = [
  'overview',
  'architecture',
  'packages',
  'conventions',
  'process',
  'examples',
  'reference',
] as const;

export const SECTION_LABELS: Record<string, string> = {
  overview: 'Overview',
  architecture: 'Architecture',
  packages: 'Packages',
  conventions: 'Conventions',
  process: 'Process',
  examples: 'Examples',
  reference: 'Reference',
};

/** Reserved OKF filenames that carry no `type:` frontmatter and are never counted as concepts. */
export const RESERVED_FILES = new Set(['index.md', 'log.md']);

/** The explorer's brand, shown in the page title and the top bar. */
export const VIZ_BRAND = 'IGNIS';

/** The explorer's project prose, per locale. Section keys match SECTION_ORDER. */
export const VIZ_COPY: Record<TLocale, IVizCopy> = {
  en: {
    heading: 'Understand IGNIS, one concept at a time.',
    tagline:
      'The IGNIS framework, end to end - packages, architecture, conventions, process and examples.',
    sectionDescriptions: {
      overview: 'Start here - what IGNIS is and how to work in it.',
      architecture: 'How the pieces fit: DI, lifecycle, repositories, and cross-cutting design.',
      packages: 'The published framework packages.',
      conventions: 'How the code is written - patterns, style, and gotchas.',
      process: 'How the team works - build, test, release, git.',
      examples: 'Runnable apps that exercise the framework.',
      reference: 'Look-ups - generated catalogs, glossary, key files.',
    },
  },
  vi: {
    heading: 'Hiểu IGNIS, từng khái niệm một.',
    tagline: 'Toàn bộ framework IGNIS - package, kiến trúc, quy ước, quy trình và ví dụ.',
    sectionDescriptions: {
      overview: 'Bắt đầu ở đây - IGNIS là gì và cách làm việc.',
      architecture: 'Cách các phần ghép lại: DI, vòng đời, repository, thiết kế xuyên suốt.',
      packages: 'Các package của framework.',
      conventions: 'Cách viết code - pattern, style, và các bẫy.',
      process: 'Cách team làm việc - build, test, release, git.',
      examples: 'Các app chạy được minh hoạ framework.',
      reference: 'Tra cứu - catalog sinh tự động, glossary, file quan trọng.',
    },
  },
};

/** What a stale check tells the person: the tool command works in any project, a make target may not exist. */
export const REGENERATE_HINT = 'run `vulcan x okf gen`';
