/** The embedding wiki's document when framed on the same origin; `undefined` alone or cross-origin. */
export const readParentDocument = (): Document | undefined => {
  try {
    const parentDocument = window.parent.document;

    return parentDocument === document ? undefined : parentDocument;
  } catch (error) {
    console.debug(
      '[readParentDocument] parent frame is cross-origin - using this page only',
      error,
    );

    return undefined;
  }
};
