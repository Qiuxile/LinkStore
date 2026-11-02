<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    wide?: boolean;
    closeable?: boolean;
  }>(),
  {
    subtitle: "",
    wide: false,
    closeable: true,
  },
);

const emit = defineEmits<{ close: [] }>();
const titleId = useId();
const subtitleId = useId();
const dialogElement = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";

function close(): void {
  if (!props.closeable) return;
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

onMounted(() => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKeydown);
  requestAnimationFrame(() => dialogElement.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = previousOverflow;
  previousFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="close">
      <section
        ref="dialogElement"
        class="modal"
        :class="{ 'modal-wide': wide }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="subtitle ? subtitleId : undefined"
        tabindex="-1"
      >
        <header class="modal-header">
          <div>
            <h2 :id="titleId">{{ title }}</h2>
            <p v-if="subtitle" :id="subtitleId" class="modal-subtitle">
              {{ subtitle }}
            </p>
          </div>
          <button
            v-if="closeable"
            class="icon-btn"
            type="button"
            aria-label="关闭"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="modal-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
