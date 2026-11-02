<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AdminCode, CodeFormValues } from "../types";
import ModalShell from "./ModalShell.vue";

const props = defineProps<{
  mode: "create" | "edit";
  initial?: AdminCode | null;
  submitting: boolean;
  serverError: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [values: CodeFormValues];
}>();

function toLocalDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const targetUrl = ref(props.initial?.targetUrl ?? "");
const maxUses = ref<number | string>(props.initial?.maxUses ?? 1);
const expiresAt = ref(toLocalDateTime(props.initial?.expiresAt ?? null));
const disabled = ref(props.initial?.disabled ?? false);
const customMode = ref(false);
const customCode = ref("");
const localError = ref("");
const errorElement = ref<HTMLElement | null>(null);

const isEdit = computed(() => props.mode === "edit");
const minDateTime = computed(() =>
  toLocalDateTime(new Date(Date.now() + 60_000).toISOString()),
);
const title = computed(() =>
  isEdit.value ? "编辑兑换码" : "新建兑换码",
);
const subtitle = computed(() =>
  isEdit.value
    ? "兑换码明文不会保存，也无法再次查看。"
    : "系统默认生成 192 bit 随机码；兑换码明文只显示一次。",
);

function validate(): CodeFormValues | null {
  localError.value = "";
  const rawUrl = targetUrl.value.trim();
  if (!rawUrl) {
    localError.value = "请填写目标地址。";
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    try {
      parsedUrl = new URL(`https://${rawUrl}`);
    } catch {
      localError.value = "目标地址必须是完整的 http:// 或 https:// 地址。";
      return null;
    }
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    localError.value = "目标地址只允许 http:// 或 https://。";
    return null;
  }
  if (parsedUrl.username || parsedUrl.password) {
    localError.value = "目标地址不能包含用户名或密码。";
    return null;
  }
  if (parsedUrl.href.length > 2048) {
    localError.value = "目标地址过长。";
    return null;
  }

  const parsedMaxUses = Number(maxUses.value);
  if (
    !Number.isInteger(parsedMaxUses) ||
    parsedMaxUses < 1 ||
    parsedMaxUses > 1_000_000
  ) {
    localError.value = "最大使用次数需为 1 到 1,000,000 的整数。";
    return null;
  }

  let normalizedExpiry: string | null = null;
  if (expiresAt.value) {
    const expiryDate = new Date(expiresAt.value);
    if (!Number.isFinite(expiryDate.getTime())) {
      localError.value = "过期时间格式不正确。";
      return null;
    }
    if (expiryDate.getTime() <= Date.now()) {
      localError.value = "过期时间必须晚于当前时间。";
      return null;
    }
    normalizedExpiry = expiryDate.toISOString();
  }

  let manualCode: string | undefined;
  if (!isEdit.value && customMode.value) {
    manualCode = customCode.value.trim();
    if (manualCode.length < 8 || manualCode.length > 128) {
      localError.value = "自定义兑换码长度需为 8 到 128 个字符。";
      return null;
    }
  }

  return {
    targetUrl: parsedUrl.href,
    maxUses: parsedMaxUses,
    expiresAt: normalizedExpiry,
    disabled: isEdit.value ? disabled.value : false,
    code: manualCode,
  };
}

async function submit(): Promise<void> {
  console.info("[LinkStore] create submit clicked");
  if (props.submitting) return;
  const values = validate();
  if (!values) {
    console.info("[LinkStore] create validation failed", localError.value);
    await nextTick();
    errorElement.value?.scrollIntoView({ block: "nearest" });
    return;
  }
  emit("submit", values);
}

watch(
  () => props.serverError,
  async (message) => {
    if (!message) return;
    await nextTick();
    errorElement.value?.scrollIntoView({ block: "nearest" });
  },
);
</script>

<template>
  <ModalShell
    :title="title"
    :subtitle="subtitle"
    :closeable="!submitting"
    wide
    @close="emit('close')"
  >
    <form id="code-form" class="code-form" novalidate @submit.prevent="submit">
      <p
        v-if="localError || serverError"
        ref="errorElement"
        class="form-error"
        role="alert"
        tabindex="-1"
      >
        {{ localError || serverError }}
      </p>

      <div class="field">
        <label for="code-target">目标地址</label>
        <input
          id="code-target"
          v-model="targetUrl"
          class="text-input"
          type="url"
          inputmode="url"
          placeholder="https://example.com/download"
          autocomplete="off"
          maxlength="2048"
          :disabled="submitting"
          autofocus
        />
        <p class="field-hint">保存后用户兑换成功会跳转到此地址；可以省略 https://。</p>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="code-max-uses">最大使用次数</label>
          <input
            id="code-max-uses"
            v-model="maxUses"
            class="text-input"
            type="number"
            min="1"
            max="1000000"
            step="1"
            inputmode="numeric"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label for="code-expiry">过期时间（可选）</label>
          <input
            id="code-expiry"
            v-model="expiresAt"
            class="text-input"
            type="datetime-local"
            :min="minDateTime"
            :disabled="submitting"
          />
          <p class="field-hint">留空表示永不过期。</p>
        </div>
      </div>

      <label v-if="isEdit" class="switch-row">
        <input v-model="disabled" type="checkbox" :disabled="submitting" />
        <span>
          <strong>停用此兑换码</strong>
          <small>停用后兑换会立即失败，历史使用次数保留。</small>
        </span>
      </label>

      <div v-if="!isEdit" class="advanced-box">
        <label class="check-row">
          <input
            v-model="customMode"
            type="checkbox"
            :disabled="submitting"
          />
          <span>使用自定义兑换码（高级）</span>
        </label>

        <div v-if="customMode" class="custom-code-field">
          <label class="sr-only" for="custom-code">自定义兑换码</label>
          <input
            id="custom-code"
            v-model="customCode"
            class="text-input mono-input"
            type="text"
            placeholder="至少 8 个字符"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="128"
            :disabled="submitting"
          />
          <p class="field-hint warning-hint">
            低熵自定义码可能被枚举。除非你确定其随机性足够，否则建议使用系统生成码；系统生成码包含 192 bit 熵。
          </p>
        </div>
      </div>

    </form>

    <template #footer>
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="submitting"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="submitting"
        @click="submit"
      >
        <span v-if="submitting" class="spinner" aria-hidden="true"></span>
        <span>{{ isEdit ? "保存修改" : "创建兑换码" }}</span>
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.code-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 16px;
}

.switch-row,
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
}

.switch-row {
  padding: 12px;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  background: #0d0d0d;
}

.switch-row input,
.check-row input {
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--accent);
}

.switch-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.switch-row strong {
  font-weight: 500;
}

.switch-row small {
  color: var(--muted);
  font-size: 11px;
}

.advanced-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 13px;
  border: 1px dashed #333333;
  border-radius: 3px;
  background: #0d0d0d;
}

.custom-code-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mono-input {
  font-family: var(--font-mono);
  font-size: 13px;
}

.warning-hint {
  color: #a8a8a8;
}

.form-error {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid #666666;
  border-radius: 2px;
  background: #111111;
  color: #f2f2f2;
  font-size: 11px;
  line-height: 1.6;
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
