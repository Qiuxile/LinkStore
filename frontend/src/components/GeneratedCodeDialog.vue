<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import ModalShell from "./ModalShell.vue";

const props = defineProps<{
  code: string;
  targetUrl: string;
}>();

const emit = defineEmits<{ close: [] }>();
const codeElement = ref<HTMLElement | null>(null);
const copied = ref(false);
let resetTimer: number | undefined;

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.code);
    showCopied();
  } catch {
    const element = codeElement.value;
    if (!element) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      if (document.execCommand("copy")) showCopied();
    } catch {
      // The code remains selectable if clipboard access is unavailable.
    }
  }
}

function showCopied(): void {
  copied.value = true;
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(() => {
    copied.value = false;
  }, 2500);
}

onBeforeUnmount(() => window.clearTimeout(resetTimer));
</script>

<template>
  <ModalShell
    title="兑换码已创建"
    subtitle="兑换码明文只在这里显示一次，关闭后无法再次查看。"
    wide
    @close="emit('close')"
  >
    <div class="generated-code-wrap">
      <span class="generated-label">兑换码</span>
      <code ref="codeElement" class="generated-code">{{ code }}</code>
      <button class="btn btn-secondary copy-button" type="button" @click="copyCode">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="7" y="7" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.4" />
          <path d="M5 12.5H4.5A1.5 1.5 0 0 1 3 11V4.5A1.5 1.5 0 0 1 4.5 3H11a1.5 1.5 0 0 1 1.5 1.5V5" stroke="currentColor" stroke-width="1.4" />
        </svg>
        {{ copied ? "已复制" : "复制兑换码" }}
      </button>
    </div>

    <div class="generated-target">
      <span>跳转地址</span>
      <p>{{ targetUrl }}</p>
    </div>

    <div class="generated-warning">
      请立即保存。数据库只保存 SHA-256 哈希，管理员也无法恢复此兑换码。
    </div>

    <template #footer>
      <button class="btn btn-primary" type="button" @click="emit('close')">
        我已保存
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.generated-code-wrap {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 20px;
  border: 1px solid rgba(11, 107, 79, 0.2);
  border-radius: var(--radius-md);
  background:
    linear-gradient(135deg, rgba(228, 242, 235, 0.85), rgba(250, 249, 245, 0.9));
}

.generated-label {
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.generated-code {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-family:
    "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: clamp(15px, 3vw, 19px);
  font-weight: 600;
  line-height: 1.55;
  user-select: all;
}

.copy-button {
  align-self: flex-start;
  margin-top: 3px;
}

.copy-button svg {
  width: 16px;
  height: 16px;
}

.generated-target {
  margin-top: 20px;
}

.generated-target span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

.generated-target p {
  margin: 7px 0 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.55;
}

.generated-warning {
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
  line-height: 1.6;
}
</style>
