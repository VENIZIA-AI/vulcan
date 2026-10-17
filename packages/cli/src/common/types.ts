import type { VulcanCommands, VulcanTools } from './constants.ts';

/** The values of a const class's static fields: `TConstValue<typeof Colors>` is `'red' | 'blue'`. */
export type TConstValue<TClass> = Extract<TClass[keyof TClass], string | number> & {};

export type TVulcanCommand = TConstValue<typeof VulcanCommands>;
export type TVulcanTool = TConstValue<typeof VulcanTools>;

/** Where `vulcan x` finds a tool: the npm package and the bin it declares. */
export interface IToolPackage {
  packageName: string;
  binName: string;
}

export interface ICommandContext {
  args: string[];
  cwd: string;
}

/** Every command resolves to the process exit code; diagnostics go to stderr. */
export type TCommandHandler = (opts: ICommandContext) => Promise<number>;
