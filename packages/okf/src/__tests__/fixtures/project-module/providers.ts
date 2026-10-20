import { defineRenderer } from '../../../index.ts';

export default defineRenderer({
  id: 'providers',
  collect: () => ['AuthProvider'],
  render: ({ facts }) => ({
    path: 'reference/providers.md',
    content: `---\ntype: Reference\n---\n\n${facts.join(', ')}\n`,
  }),
  coverage: ({ facts }) => ({ name: 'providers', count: facts.length }),
});
