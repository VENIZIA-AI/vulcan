<!-- VULCAN's home page: the shared home layout with VULCAN's words. -->
<script setup lang="ts">
import { HOME } from './home-content';
import HomeLayout from './shared/HomeLayout.vue';
</script>

<template>
  <HomeLayout :content="HOME" />
</template>
