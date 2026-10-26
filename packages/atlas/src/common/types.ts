import type {
  AppSides,
  AtlasModes,
  Corpora,
  LogLevels,
  PackageKinds,
  SkillSources,
  SourcePins,
} from './constants';

/** The values of a const class's static fields: `TConstValue<typeof Colors>` is `'red' | 'blue'`. */
export type TConstValue<TClass> = Extract<TClass[keyof TClass], string | number> & {};

export type TAtlasMode = TConstValue<typeof AtlasModes>;
export type TCorpus = TConstValue<typeof Corpora>;
export type TLogLevel = TConstValue<typeof LogLevels>;
export type TSkillSource = TConstValue<typeof SkillSources>;
export type TPackageKind = TConstValue<typeof PackageKinds>;
export type TAppSide = TConstValue<typeof AppSides>;
export type TSourcePin = TConstValue<typeof SourcePins>;

/** A scoped logger; `for` narrows the scope to one method. Every line goes to stderr. */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  emerg(message: string, ...args: unknown[]): void;
  log(level: TLogLevel, message: string, ...args: unknown[]): void;
  for(methodName: string): ILogger;
}

/** The part of a package.json the generators read. */
export interface IPackageManifest {
  name: string;
  /** Conditions other than `types` (`import`, `require`, `default`...) are read by nobody here. */
  exports: Record<string, string | { types?: string; [condition: string]: unknown }>;
}

/** One `exports` subpath and the declaration file that types it. */
export interface IDeclarationEntry {
  subpath: string;
  types: string;
}

/** One package of a run: its manifest and the absolute declaration file of each typed entry. */
export interface IPackageEntries {
  name: string;
  manifest: IPackageManifest;
  entries: { subpath: string; file: string }[];
}
