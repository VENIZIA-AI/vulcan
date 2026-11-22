import { SpecPage } from '../../visualize/index.ts';

/**
 * Renders a spec as a page. The page language is not part of a spec: a test names it as `language` on the object it
 * passes, and it is handed over as the owner profile's language, the way the command does.
 */
export const renderSpec = (
  spec: Record<string, unknown>,
): ReturnType<typeof SpecPage.renderText> => {
  const { language, ...rest } = spec;

  return SpecPage.renderText({
    text: JSON.stringify(rest),
    context: { language: typeof language === 'string' ? language : undefined },
  });
};
