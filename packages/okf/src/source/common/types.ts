export type ComponentEntry = { dir: string; classes: string[] };
export type HelperEntry = { module: string; classes: string[] };
export type BindingClass = { name: string; keys: { key: string; value: string }[] };
export type MakeTarget = { name: string; deps: string; description: string };
export type SourceMapEntry = {
  pkg: string;
  total: number;
  subsystems: { name: string; files: number }[];
};
