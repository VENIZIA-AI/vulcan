<!--
  Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
  scripts/wiki-shared in VULCAN. Edit it there, never in a copy.

  The title block of a changelog page: a link back to the index, the date and the type chips, the title, and the
  packages with the version. For a dated entry it replaces the entry's own heading (the generic "Changelog - date"
  h1, the title repeated as an h2 and the badge line), which changelog.css hides. For a version folder
  (changelogs/<X.Y.Z>/log.md, which has no heading of its own) it shows the release date, or "In progress", and - when
  the page has a Breaking section and the wiki names its migrate guide in `themeConfig.migrateGuide` - a link to it.
-->
<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';
import { data } from './changelog.data';
import { data as versions } from './changelog-versions.data';
import { formatDate } from './changelog-entries';

const { page, theme } = useData();

/** The last segment of a dated entry's path, or the folder of a version page. */
const slug = computed(() => page.value.relativePath.replace(/\.md$/, '').split('/').pop());
const versionOfPage = computed(() => {
  // A wiki serves changelogs/<X.Y.Z>/log.md at changelogs/<X.Y.Z> (a rewrite): the page knows itself by either path.
  const matched = /^changelogs\/(\d+\.\d+\.\d+)(?:\/log)?\.md$/.exec(page.value.relativePath);

  return matched === null
    ? undefined
    : versions.find((candidate) => candidate.version === matched[1]);
});

const entry = computed(() => data.find((candidate) => candidate.slug === slug.value));

const meta = computed(() =>
  entry.value === undefined
    ? ''
    : [entry.value.packages.join(', '), entry.value.version]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
);

const migrateGuide = computed<string | undefined>(() =>
  typeof theme.value.migrateGuide === 'string' ? theme.value.migrateGuide : undefined,
);
</script>

<template>
  <div v-if="versionOfPage" class="ce-head ce-head--version">
    <a class="ce-back" href="/changelogs/">All changes</a>
    <p class="ce-line">
      <time v-if="versionOfPage.released" :datetime="versionOfPage.released">{{
        formatDate(versionOfPage.released)
      }}</time>
      <span v-else class="cl-chip">In progress</span>
    </p>
    <h1 class="ce-title">{{ versionOfPage.title }}</h1>
    <p v-if="versionOfPage.packages.length" class="cl-meta">
      {{ versionOfPage.packages.join(', ') }}
    </p>
    <p v-if="versionOfPage.hasBreaking && migrateGuide" class="cl-meta">
      Upgrading across breaking changes: <a :href="migrateGuide">migrate between releases</a>
    </p>
  </div>
  <div v-else-if="entry" class="ce-head">
    <a class="ce-back" href="/changelogs/">All changes</a>
    <p class="ce-line">
      <time :datetime="entry.date">{{ formatDate(entry.date) }}</time>
      <span v-for="type in entry.types" :key="type.label" class="cl-chip">{{ type.label }}</span>
    </p>
    <h1 class="ce-title">{{ entry.title }}</h1>
    <p v-if="meta" class="cl-meta">{{ meta }}</p>
  </div>
</template>
