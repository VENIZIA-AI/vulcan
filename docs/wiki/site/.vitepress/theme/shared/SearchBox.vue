<!--
  Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
  scripts/wiki-shared in VULCAN. Edit it there, never in a copy.

  The search of a wiki: a button in the top bar (Ctrl+K, Cmd+K or "/") that opens a dialog over the Pagefind index the
  build wrote. Arrows move through the results, Enter opens one, Escape closes.
-->
<script setup lang="ts">
import { useRouter, withBase } from 'vitepress';
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { WikiSearch } from './search';
import type { ISearchHit } from './search';

const router = useRouter();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const input = useTemplateRef<HTMLInputElement>('input');
const query = ref('');
const hits = ref<ISearchHit[]>([]);
const picked = ref(0);
const state = ref<'idle' | 'searching' | 'done' | 'unavailable'>('idle');

let asked = 0;

const open = async (): Promise<void> => {
  if (dialog.value?.open === false) {
    dialog.value.showModal();
    await nextTick();
    input.value?.select();
  }
};
const close = (): void => dialog.value?.close();
const go = async (hit: ISearchHit | undefined): Promise<void> => {
  if (hit !== undefined) {
    close();
    await router.go(hit.url);
  }
};
const move = async (step: number): Promise<void> => {
  const count = hits.value.length;

  if (count > 0) {
    picked.value = (picked.value + step + count) % count;
    await nextTick();
    dialog.value?.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
  }
};

watch(query, async (text) => {
  const turn = ++asked;

  if (text.trim() === '') {
    hits.value = [];
    state.value = 'idle';

    return;
  }

  state.value = 'searching';

  try {
    const found = await WikiSearch.find({ url: withBase('/pagefind/pagefind.js'), query: text });

    // A slower answer to an earlier text is dropped.
    if (turn === asked) {
      hits.value = found;
      picked.value = 0;
      state.value = 'done';
    }
  } catch (error) {
    console.error('[SearchBox] search failed', error);

    if (turn === asked) {
      hits.value = [];
      state.value = 'unavailable';
    }
  }
});

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const onKey = async (event: KeyboardEvent): Promise<void> => {
  const isShortcut =
    (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) ||
    (event.key === '/' && !isTyping(event.target));

  if (isShortcut) {
    event.preventDefault();
    await open();
  }
};

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="wiki-search">
    <button type="button" class="search-button" aria-label="Search" @click="open">
      <span class="search-icon" aria-hidden="true"></span>
      <span class="search-label">Search</span>
      <span class="search-keys" aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
    </button>
    <dialog ref="dialog" class="search-dialog" aria-label="Search" @click.self="close">
      <div class="search-panel">
        <input
          ref="input"
          v-model="query"
          type="search"
          placeholder="Search"
          aria-label="Search"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="go(hits[picked])"
        />
        <p v-if="state === 'unavailable'" class="search-note" role="status">
          Search is not available here: the index is written by the site build.
        </p>
        <p v-else-if="state === 'done' && hits.length === 0" class="search-note" role="status">
          No result for "{{ query }}".
        </p>
        <ul v-if="hits.length > 0" class="search-hits">
          <li v-for="(hit, index) in hits" :key="hit.url" :class="{ picked: index === picked }">
            <a :href="hit.url" @click.prevent="go(hit)" @mousemove="picked = index">
              <span class="hit-title">{{ hit.title }}</span>
              <span class="hit-excerpt" v-html="hit.excerpt"></span>
            </a>
          </li>
        </ul>
      </div>
    </dialog>
  </div>
</template>
