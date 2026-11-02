<script setup lang="ts">
import AdminView from "./views/AdminView.vue";
import HomeView from "./views/HomeView.vue";

const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isAdmin = normalizedPath === "/admin";
</script>

<template>
  <AdminView v-if="isAdmin" />
  <HomeView v-else />
</template>
