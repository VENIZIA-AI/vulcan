<!--
  Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
  scripts/wiki-shared in VULCAN. Edit it there, never in a copy.

  The details page of a version (`/changelogs/<X.Y.Z>`): the summary and the highlights, then every item as a card that opens
  to its full text, under its section. A left rail lists the sections, searches the items and filters them by package; a
  sticky right rail shows the upgrade path. The items come from the log at build time (changelog-items.data.ts), so every card
  is in the HTML and the page reads without script; the search and the filter only hide cards. SiteLayout mounts this as an
  async component, so the items stay out of the script every page loads.
-->
<script setup lang="ts">
import { useData } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ChangelogCounts from './ChangelogCounts.vue';
import ChangelogItem from './ChangelogItem.vue';
import ChangelogPath from './ChangelogPath.vue';
import { data as guideCounts } from './changelog-guide-counts.data';
import { data as itemSets } from './changelog-items.data';
import { data as versions } from './changelog-versions.data';
import { formatDate } from './changelog-entries';
import {
  SECTION_NAMES,
  renderInline,
  shortPackage,
  type TSectionName,
  type TVersionItem,
} from './changelog-items';

/** Above this many Breaking items the section is grouped by package. */
const GROUP_FROM = 12;
const { page } = useData();

const version = computed(
  () => /^changelogs\/(\d+\.\d+\.\d+)/.exec(page.value.relativePath)?.[1] ?? '',
);
const entry = computed(() => versions.find((candidate) => candidate.version === version.value));
const items = computed<TVersionItem[]>(
  () => itemSets.find((candidate) => candidate.version === version.value)?.items ?? [],
);
const guide = computed(() => guideCounts.find((candidate) => candidate.version === version.value));
const guideUrl = computed(() => `/changelogs/${version.value}/upgrade`);
const prerelease = computed(() => entry.value !== undefined && entry.value.released === null);

const query = ref('');
const selected = ref<Set<string>>(new Set());

const haystack = computed(
  () =>
    new Map(
      items.value.map((item) => [
        item.id,
        `${item.title} ${item.id} ${item.html.replace(/<[^>]+>/g, ' ')}`.toLowerCase(),
      ]),
    ),
);

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();

  return items.value.filter(
    (item) =>
      (needle === '' || (haystack.value.get(item.id) ?? '').includes(needle)) &&
      (selected.value.size === 0 ||
        item.packages.some((name) => selected.value.has(shortPackage({ name })))),
  );
});

type TSection = { name: TSectionName; items: TVersionItem[]; groups: [string, TVersionItem[]][] };

const sections = computed<TSection[]>(() =>
  SECTION_NAMES.flatMap((name): TSection[] => {
    const own = visible.value.filter((item) => item.section === name);

    if (own.length === 0) {
      return [];
    }

    const grouped = name === 'Breaking' && own.length > GROUP_FROM;
    const groups = new Map<string, TVersionItem[]>();

    for (const item of own) {
      const key = grouped ? shortPackage({ name: item.packages[0] ?? 'other' }) : '';

      groups.set(key, [...(groups.get(key) ?? []), item]);
    }

    return [{ name, items: own, groups: grouped ? [...groups] : [] }];
  }),
);

const navigation = computed(() =>
  SECTION_NAMES.flatMap((name): [TSectionName, number][] => {
    const count = items.value.filter((item) => item.section === name).length;

    return count === 0 ? [] : [[name, count]];
  }),
);

const packages = computed(() => {
  const counts = new Map<string, number>();

  for (const item of items.value) {
    for (const name of new Set(
      item.packages.map((entryName) => shortPackage({ name: entryName })),
    )) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const list = [...counts].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const max = list[0]?.[1] ?? 1;

  return list.map(([name, count]) => ({ name, count, width: Math.round((count / max) * 100) }));
});

const toggle = (name: string): void => {
  const next = new Set(selected.value);

  if (!next.delete(name)) {
    next.add(name);
  }

  selected.value = next;
};

const dateLine = computed(() => {
  const released = entry.value?.released;

  return released === null || released === undefined
    ? 'In progress, on the next tag'
    : `Released ${formatDate(released)}`;
});

const summaryHtml = computed(() => renderInline({ text: entry.value?.summary ?? '' }));
const overviewWords = computed(
  () => (entry.value?.overview ?? '').split(/\s+/).filter(Boolean).length,
);
const showOverview = computed(
  () =>
    entry.value !== undefined &&
    entry.value.overview !== '' &&
    entry.value.overview !== entry.value.summary,
);

const isCovered = (id: string): boolean => guide.value?.covered.includes(id) ?? false;
const hasStep = (id: string): boolean => guide.value?.ids.includes(id) ?? false;

/** A link to an item (`#<id>`) opens its card. */
const openHash = (): void => {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const card = id === '' ? null : document.getElementById(id);

  if (card instanceof HTMLDetailsElement) {
    card.open = true;
  }
};

onMounted(() => {
  openHash();
  window.addEventListener('hashchange', openHash);
});
onBeforeUnmount(() => window.removeEventListener('hashchange', openHash));
</script>

<template>
  <div v-if="entry" class="cx-detail">
    <aside class="cx-rail cx-rail--left" aria-label="Find in this release">
      <div v-if="navigation.length">
        <h2 class="cx-label">On this page</h2>
        <nav>
          <a v-for="[name, count] in navigation" :key="name" :href="`#${name.toLowerCase()}`"
            >{{ name }}<span>{{ count }}</span></a
          >
        </nav>
      </div>
      <input
        v-model="query"
        class="cx-search"
        type="search"
        :placeholder="`Search ${items.length} items`"
        aria-label="Search the items"
      />
      <div v-if="packages.length > 1">
        <h2 class="cx-label">Packages</h2>
        <div class="cx-pf">
          <button
            v-for="pkg in packages"
            :key="pkg.name"
            type="button"
            :aria-pressed="selected.has(pkg.name)"
            :style="{ '--w': `${pkg.width}%` }"
            @click="toggle(pkg.name)"
          >
            {{ pkg.name }}<span>{{ pkg.count }}</span>
          </button>
        </div>
      </div>
    </aside>

    <div class="cx-main">
      <div class="cx-crumb"><a href="/changelogs/">Changelog</a> / {{ version }}</div>
      <div class="cx-title">
        <h1>{{ version }}</h1>
        <span :class="['cx-chip', prerelease ? 'cx-chip--pre' : 'cx-chip--stable']">{{
          prerelease ? 'Prerelease' : 'Stable'
        }}</span>
        <span class="cx-chip">{{ dateLine }}</span>
      </div>
      <p v-if="entry.summary" class="cx-sum" v-html="summaryHtml"></p>
      <div class="cx-overview">
        <div v-if="entry.highlights.length">
          <h2 class="cx-label">In this release</h2>
          <ul class="cx-hl">
            <li
              v-for="(line, index) in entry.highlights"
              :key="index"
              v-html="renderInline({ text: line })"
            ></li>
          </ul>
        </div>
        <ChangelogCounts :counts="entry.counts" />
      </div>
      <details v-if="showOverview" class="cx-readmore">
        <summary>Read the full overview ({{ overviewWords }} words)</summary>
        <p v-html="renderInline({ text: entry.overview })"></p>
      </details>

      <nav class="cx-tabs" :aria-label="version">
        <a :href="`/changelogs/${version}`" aria-current="page"
          >Changes <span>{{ items.length }}</span></a
        >
        <a v-if="guide" :href="guideUrl"
          >Upgrade guide <span>{{ guide.ids.length }}</span></a
        >
      </nav>

      <section
        v-for="section in sections"
        :key="section.name"
        :class="['cx-sec', `t-${section.name.toLowerCase()}`]"
      >
        <h2 :id="section.name.toLowerCase()">
          {{ section.name }} <span>{{ section.items.length }}</span>
        </h2>
        <template v-if="section.groups.length">
          <div v-for="[group, list] in section.groups" :key="group" class="cx-grp">
            <h3>
              <span>{{ group }}</span
              ><span>{{ list.length }}</span>
            </h3>
            <ChangelogItem
              v-for="item in list"
              :key="item.id"
              :item="item"
              :step-url="hasStep(item.id) ? guideUrl : undefined"
              :covered="isCovered(item.id)"
            />
          </div>
        </template>
        <template v-else>
          <ChangelogItem
            v-for="item in section.items"
            :key="item.id"
            :item="item"
            :step-url="hasStep(item.id) ? guideUrl : undefined"
            :covered="isCovered(item.id)"
          />
        </template>
      </section>
      <p v-if="items.length && sections.length === 0" class="cx-empty">
        No item matches the search and the filter.
      </p>
      <p v-if="items.length === 0" class="cx-empty">This version's log has no itemised changes.</p>
    </div>

    <ChangelogPath
      :version="version"
      :packages="entry.packages.length"
      :guide="guide"
      :guide-url="guideUrl"
    />
  </div>
</template>
