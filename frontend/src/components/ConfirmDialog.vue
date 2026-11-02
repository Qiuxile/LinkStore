<script setup lang="ts">
import ModalShell from "./ModalShell.vue";

defineProps<{
  title: string;
  message: string;
  busy: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <ModalShell
    :title="title"
    :closeable="!busy"
    @close="emit('close')"
  >
    <p class="confirm-message">{{ message }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <template #footer>
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="busy"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        class="btn btn-danger"
        type="button"
        :disabled="busy"
        @click="emit('confirm')"
      >
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        <span>{{ busy ? "删除中" : "确认删除" }}</span>
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.confirm-message {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
</style>
