export type TBindingClass = { name: string; keys: { key: string; value: string }[] };
export type TMakeTarget = { name: string; deps: string; description: string };
export type TSourceMapEntry = {
  pkg: string;
  total: number;
  subsystems: { name: string; files: number }[];
};
