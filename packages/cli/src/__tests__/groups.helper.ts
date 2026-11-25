import { ConfigGroups } from '../config/index.ts';

const RecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A flat config object (what the schema parses) as the grouped file a project writes: for a test that needs both. */
export const groupsOf = (opts: { flat: Record<string, unknown> }): Record<string, unknown> => {
  const out: Record<string, Record<string, unknown>> = {};
  const put = (group: string, key: string | undefined, value: unknown): void => {
    out[group] = { ...out[group], ...(key === undefined ? (value as object) : { [key]: value }) };
  };

  for (const [key, value] of Object.entries(opts.flat)) {
    if (key === 'guard') {
      return { ...groupsOf({ flat: { ...opts.flat, guard: undefined } }), guard: value };
    }

    if (key === 'knowledge') {
      put('knowledge', undefined, value);
    } else if (ConfigGroups.KNOWLEDGE_TOOLS.includes(key)) {
      put('knowledge', key, value);
    } else {
      const found = Object.entries(ConfigGroups.GROUPS).find(([, keys]) =>
        Object.values(keys).some((target) => target.to === key),
      );
      const inner =
        found === undefined
          ? undefined
          : Object.entries(found[1]).find(
              ([, target]) => target.to === key && target.inner === undefined,
            );

      if (key === 'project' && RecordLike(value)) {
        put('project', undefined, value);
      } else if (found !== undefined && inner !== undefined) {
        put(found[0], inner[0], value);
      }
    }
  }

  return out;
};
