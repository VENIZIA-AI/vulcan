// --- managed regions ---

export const markers = (opts: { id: string }): { start: string; end: string } => {
  return {
    start: `<!-- okf:generated:${opts.id} start -->`,
    end: `<!-- okf:generated:${opts.id} end -->`,
  };
};

/** Locate a managed region, rejecting malformed or duplicated markers rather than corrupting the file. */
export const locateRegion = (opts: {
  text: string;
  id: string;
}): { start: string; end: string; startAt: number; endAt: number } => {
  const { text, id } = opts;

  const { start, end } = markers({ id });
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);

  if (startAt === -1 || endAt === -1) {
    throw new Error(`managed region '${id}' not found`);
  }

  if (text.indexOf(start, startAt + 1) !== -1) {
    throw new Error(`managed region '${id}' has a duplicate start marker`);
  }

  if (text.indexOf(end, endAt + 1) !== -1) {
    throw new Error(`managed region '${id}' has a duplicate end marker`);
  }

  if (startAt + start.length > endAt) {
    throw new Error(`managed region '${id}' is malformed - end marker precedes start marker`);
  }

  return { start, end, startAt, endAt };
};

export const replaceRegion = (opts: { text: string; id: string; body: string }): string => {
  const { text, id, body } = opts;

  const { start, startAt, endAt } = locateRegion({ text, id });

  return text.slice(0, startAt + start.length) + '\n' + body + '\n' + text.slice(endAt);
};

export const extractRegion = (opts: { text: string; id: string }): string | null => {
  const { text, id } = opts;

  let located;

  try {
    located = locateRegion({ text, id });
  } catch (error) {
    console.warn(`okf: ${(error as Error).message}`);

    return null;
  }

  return text.slice(located.startAt + located.start.length, located.endAt).trim();
};
