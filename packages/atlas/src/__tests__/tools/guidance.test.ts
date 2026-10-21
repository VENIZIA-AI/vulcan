import { describe, expect, test } from 'bun:test';
import {
  buildChangesTool,
  buildGetTool,
  buildSearchTool,
  buildSymbolTool,
  buildVersionTool,
} from '@/tools';
import { ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { SymbolStore } from '@/symbols';

// The descriptions are the only text an agent reads before it chooses a tool: each names when to call it.
// None of the builders runs a tool here, so the stores are empty.
const chunks = new ChunkStore();
const symbols = new SymbolStore({ symbols: [] });
const releases = new ReleaseStore({ table: { packageMap: [], releases: {}, changelogs: [] } });
const PROJECTS = 'acme and ignis';

const descriptionsOf = (opts: { projects?: string }): Record<string, string> => ({
  symbol: buildSymbolTool({ store: chunks, symbols, projects: opts.projects }).definition
    .description,
  search: buildSearchTool({ store: chunks, symbols, projects: opts.projects }).definition
    .description,
  get: buildGetTool({ store: chunks }).definition.description,
  version: buildVersionTool({ releases, projects: opts.projects }).definition.description,
  changes: buildChangesTool({ releases, projects: opts.projects }).definition.description,
});

describe('tool descriptions open with when to call the tool', () => {
  const descriptions = descriptionsOf({ projects: PROJECTS });

  test('symbol: before importing or calling an export of the projects', () => {
    expect(descriptions.symbol).toStartWith(
      `Before you import or call an export of ${PROJECTS}, get its real signature, import path and source line here`,
    );
  });

  test('search: when the user asks about the projects or their conventions', () => {
    expect(descriptions.search).toStartWith(
      `When the user asks how something works in ${PROJECTS}, how to build something in it, or about this project's conventions, search here before you answer from memory`,
    );
  });

  test('get: after a search hit, before relying on it', () => {
    expect(descriptions.get).toStartWith('After `search`, read the hit here before you rely on it');
  });

  test('version: when a version or an upgrade comes up', () => {
    expect(descriptions.version).toStartWith(
      `When a version, an upgrade or an installed @venizia/* package comes up in ${PROJECTS}, check here`,
    );
  });

  test('changes: when the user asks what a release changed', () => {
    expect(descriptions.changes).toStartWith(
      `When the user asks what changed, what a release added or what breaks on upgrade in ${PROJECTS}, list the entries here`,
    );
  });

  test('the original description of every tool still follows the trigger', () => {
    expect(descriptions.symbol).toContain('Locate one exported symbol by name');
    expect(descriptions.search).toContain('Search the wiki, changelogs and knowledge bundle');
    expect(descriptions.get).toContain("Read one chunk's body by the id a search hit returned");
    expect(descriptions.version).toContain('Compare the @venizia/* packages installed');
    expect(descriptions.changes).toContain('List the changelog entries between two releases');
  });
});

test('without project names a description still opens with its trigger', () => {
  const descriptions = descriptionsOf({});

  expect(descriptions.symbol).toStartWith(
    'Before you import or call an export of the projects atlas serves, get its real signature',
  );
  expect(descriptions.changes).toContain('in the projects atlas serves');
});
