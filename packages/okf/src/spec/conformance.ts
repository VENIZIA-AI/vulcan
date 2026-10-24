import {
  ConceptStatuses,
  IssueSeverities,
  OkfVersions,
  ReservedFiles,
  SpecConstants,
} from './common/index.ts';
import type { IBundleFile, IConformanceIssue, TIssueSeverity } from './common/index.ts';
import { parseYamlMapping, splitFrontmatter } from './frontmatter.ts';
import type { TYamlMapping } from './frontmatter.ts';

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})\b/;
const ISO_DATETIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ACTOR = /^(?:(?:human|process):\S+|[^\s/:]+\/[^\s/]+)$/;
const LEVEL_TWO_HEADING = /^## (.*)$/;

const createIssue = (opts: {
  file: string;
  rule: string;
  severity: TIssueSeverity;
  message: string;
}): IConformanceIssue => ({
  file: opts.file,
  rule: opts.rule,
  severity: opts.severity,
  message: opts.message,
});

const getBaseName = (opts: { path: string }): string => opts.path.split('/').pop() ?? opts.path;

/** A calendar date that exists: `2026-02-30` round-trips to another day and is rejected. */
const isRealDate = (opts: { date: string }): boolean => {
  const parsed = new Date(`${opts.date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(opts.date);
};

/** §5: every timestamp is an ISO 8601 datetime with an explicit UTC offset. */
const isTimestamp = (opts: { value: unknown }): boolean =>
  typeof opts.value === 'string' &&
  ISO_DATETIME_WITH_OFFSET.test(opts.value) &&
  !Number.isNaN(Date.parse(opts.value));

const isMapping = (opts: { value: unknown }): opts is { value: TYamlMapping } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toList = (opts: { value: unknown }): unknown[] => {
  if (Array.isArray(opts.value)) {
    return opts.value;
  }

  return opts.value === undefined ? [] : [opts.value];
};

const checkTimestamp = (opts: {
  file: string;
  field: string;
  value: unknown;
}): IConformanceIssue[] =>
  opts.value === undefined || isTimestamp({ value: opts.value })
    ? []
    : [
        createIssue({
          file: opts.file,
          rule: '§5',
          severity: IssueSeverities.WARNING,
          message: `${opts.field} must be an ISO 8601 datetime with an offset, e.g. 2026-06-30T14:00:00Z (got ${String(opts.value)})`,
        }),
      ];

const checkActor = (opts: { file: string; field: string; value: unknown }): IConformanceIssue[] =>
  typeof opts.value === 'string' && ACTOR.test(opts.value)
    ? []
    : [
        createIssue({
          file: opts.file,
          rule: '§7',
          severity: IssueSeverities.WARNING,
          message: `${opts.field} must be <producer>/<version>, human:<id> or process:<id> (got ${String(opts.value)})`,
        }),
      ];

/** §5 and §7 are soft guidance: every finding here is a warning, never a conformance error. */
const checkTrustFields = (opts: { file: string; data: TYamlMapping }): IConformanceIssue[] => {
  const { file, data } = opts;
  const issues: IConformanceIssue[] = [];

  const status = data.status;

  if (status !== undefined && (typeof status !== 'string' || !ConceptStatuses.isValid(status))) {
    issues.push(
      createIssue({
        file,
        rule: '§5.4',
        severity: IssueSeverities.WARNING,
        message: `status must be draft, stable or deprecated (got ${String(status)})`,
      }),
    );
  }

  issues.push(...checkTimestamp({ file, field: 'stale_after', value: data.stale_after }));

  toList({ value: data.sources }).forEach((source, index) => {
    const holder = { value: source };

    if (
      !isMapping(holder) ||
      typeof holder.value.resource !== 'string' ||
      holder.value.resource === ''
    ) {
      issues.push(
        createIssue({
          file,
          rule: '§5.1',
          severity: IssueSeverities.WARNING,
          message: `sources[${index}] needs a resource`,
        }),
      );

      return;
    }

    issues.push(
      ...checkTimestamp({
        file,
        field: `sources[${index}].last_modified`,
        value: holder.value.last_modified,
      }),
    );
  });

  const generated = { value: data.generated };

  if (isMapping(generated)) {
    issues.push(...checkActor({ file, field: 'generated.by', value: generated.value.by }));
    issues.push(...checkTimestamp({ file, field: 'generated.at', value: generated.value.at }));
  }

  toList({ value: data.verified }).forEach((event, index) => {
    const holder = { value: event };

    if (isMapping(holder)) {
      issues.push(...checkActor({ file, field: `verified[${index}].by`, value: holder.value.by }));
      issues.push(
        ...checkTimestamp({ file, field: `verified[${index}].at`, value: holder.value.at }),
      );
    }
  });

  return issues;
};

/** §11.1 and §11.2: parseable frontmatter with a non-empty top-level `type`. */
const checkConcept = (opts: { file: IBundleFile }): IConformanceIssue[] => {
  const { path, text } = opts.file;
  const { yaml } = splitFrontmatter({ text });

  if (yaml === undefined) {
    return [
      createIssue({
        file: path,
        rule: '§11.1',
        severity: IssueSeverities.ERROR,
        message: 'no YAML frontmatter block',
      }),
    ];
  }

  const parsed = parseYamlMapping({ yaml });

  if (!parsed.ok) {
    return [
      createIssue({
        file: path,
        rule: '§11.1',
        severity: IssueSeverities.ERROR,
        message: `unparseable frontmatter - ${parsed.reason}`,
      }),
    ];
  }

  const type = parsed.data.type;

  if (typeof type !== 'string' || type.trim() === '') {
    return [
      createIssue({
        file: path,
        rule: '§11.2',
        severity: IssueSeverities.ERROR,
        message: 'missing or empty top-level type',
      }),
    ];
  }

  return checkTrustFields({ file: path, data: parsed.data });
};

/** §8 and §12: no frontmatter, except `okf_version` alone in the bundle-root index. */
const checkIndex = (opts: { file: IBundleFile }): IConformanceIssue[] => {
  const { path, text } = opts.file;
  const { yaml } = splitFrontmatter({ text });

  if (yaml === undefined) {
    return [];
  }

  if (path !== SpecConstants.ROOT_INDEX) {
    return [
      createIssue({
        file: path,
        rule: '§8',
        severity: IssueSeverities.ERROR,
        message: 'a nested index.md carries no frontmatter',
      }),
    ];
  }

  const parsed = parseYamlMapping({ yaml });

  if (!parsed.ok) {
    return [
      createIssue({
        file: path,
        rule: '§8',
        severity: IssueSeverities.ERROR,
        message: `unparseable frontmatter - ${parsed.reason}`,
      }),
    ];
  }

  const issues: IConformanceIssue[] = [];
  const extraKeys = Object.keys(parsed.data).filter((key) => key !== SpecConstants.VERSION_KEY);

  if (extraKeys.length > 0) {
    issues.push(
      createIssue({
        file: path,
        rule: '§8',
        severity: IssueSeverities.ERROR,
        message: `the root index may carry only ${SpecConstants.VERSION_KEY} - remove: ${extraKeys.join(', ')}`,
      }),
    );
  }

  const version = parsed.data[SpecConstants.VERSION_KEY];

  if (version !== undefined && String(version) !== OkfVersions.LATEST) {
    issues.push(
      createIssue({
        file: path,
        rule: '§12',
        severity: IssueSeverities.WARNING,
        message: `declares ${SpecConstants.VERSION_KEY} ${String(version)}; the latest is ${OkfVersions.LATEST} (read best-effort)`,
      }),
    );
  }

  return issues;
};

/** §9: every `##` heading opens with a real ISO 8601 date, newest first. Text after the date is tolerated. */
const checkLog = (opts: { file: IBundleFile }): IConformanceIssue[] => {
  const { path, text } = opts.file;
  const issues: IConformanceIssue[] = [];
  let previous: string | undefined;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = LEVEL_TWO_HEADING.exec(line)?.[1];

    if (heading === undefined) {
      continue;
    }

    const date = ISO_DATE.exec(heading)?.[1];

    if (date === undefined || !isRealDate({ date })) {
      issues.push(
        createIssue({
          file: path,
          rule: '§9',
          severity: IssueSeverities.ERROR,
          message: `date heading is not YYYY-MM-DD: "## ${heading}"`,
        }),
      );
      continue;
    }

    if (previous !== undefined && date > previous) {
      issues.push(
        createIssue({
          file: path,
          rule: '§9',
          severity: IssueSeverities.ERROR,
          message: `entries must be newest first: ${date} follows ${previous}`,
        }),
      );
    }

    previous = date;
  }

  return issues;
};

/** OKF v0.2 conformance (§11) plus soft guidance. Never throws: every finding is an issue. */
export const checkBundle = (opts: { files: IBundleFile[] }): IConformanceIssue[] =>
  opts.files.flatMap((file) => {
    switch (getBaseName({ path: file.path })) {
      case ReservedFiles.INDEX: {
        return checkIndex({ file });
      }

      case ReservedFiles.LOG: {
        return checkLog({ file });
      }

      default: {
        return checkConcept({ file });
      }
    }
  });
