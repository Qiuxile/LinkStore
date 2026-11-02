<script setup lang="ts">
import { nextTick, ref } from "vue";
import { ApiError, redeem } from "../api";

const code = ref("");
const isSubmitting = ref(false);
const errorMessage = ref("");
const inputElement = ref<HTMLInputElement | null>(null);

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "请求过于频繁，请稍后再试。";
    if (error.status === 0) return "网络异常，请稍后重试。";
    if (error.status === 400) return "兑换码无效或已不可用。";
  }
  return "暂时无法完成兑换，请稍后重试。";
}

async function focusInput(): Promise<void> {
  await nextTick();
  inputElement.value?.focus();
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return;
  const submittedCode = code.value.trim();
  if (!submittedCode) {
    errorMessage.value = "兑换码无效或已不可用。";
    await focusInput();
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    const result = await redeem(submittedCode);

    if (result.type === "admin") {
      const destination = result.redirectTo ?? "";
      if (destination.startsWith("/") && !destination.startsWith("//")) {
        window.location.assign(destination);
        return;
      }
      throw new Error("Unsafe admin redirect");
    }

    if (
      result.type === "redirect" &&
      result.targetUrl &&
      isSafeHttpUrl(result.targetUrl)
    ) {
      window.location.assign(result.targetUrl);
      return;
    }

    throw new Error("Invalid redeem response");
  } catch (error) {
    errorMessage.value = errorText(error);
    code.value = "";
    await focusInput();
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="home">
    <section class="access" aria-labelledby="linkstore-title">
      <div class="brand redeem-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8 5h10v3h-7v8h7v3H8V5Z" fill="currentColor" />
            <path d="M4 8h2.5v8H4V8Z" fill="currentColor" opacity=".55" />
          </svg>
        </span>
        <span id="linkstore-title">LinkStore</span>
      </div>

      <form class="redeem-form" novalidate autocomplete="off" @submit.prevent="submit">
        <label class="sr-only" for="redeem-code">兑换码</label>
        <div class="redeem-control" :class="{ 'has-error': errorMessage }">
          <input
            id="redeem-code"
            ref="inputElement"
            v-model="code"
            class="redeem-input"
            type="text"
            name="code"
            placeholder="输入兑换码"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="256"
            :disabled="isSubmitting"
            autofocus
            @input="errorMessage = ''"
          />
          <button class="redeem-submit" type="submit" :disabled="isSubmitting">
            <span v-if="isSubmitting" class="spinner" aria-hidden="true"></span>
            <span>{{ isSubmitting ? "验证中" : "兑换" }}</span>
          </button>
        </div>
        <p class="redeem-error" role="alert" aria-live="polite">
          {{ errorMessage }}
        </p>
      </form>
    </section>
  </main>
</template>

<style scoped>
.home {
  display: grid;
  min-height: 100svh;
  padding: 32px;
  place-items: center;
  background: #050505;
}

.access {
  width: min(100%, 440px);
}

.redeem-brand {
  margin-bottom: 40px;
  color: #f5f5f5;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.redeem-brand .brand-mark {
  width: 28px;
  height: 28px;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: transparent;
  color: #f5f5f5;
  box-shadow: none;
}

.redeem-brand .brand-mark svg {
  width: 16px;
  height: 16px;
}

.redeem-form {
  width: 100%;
}

.redeem-control {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #080808;
  transition: border-color 130ms ease;
}

.redeem-control:focus-within {
  border-color: #f5f5f5;
}

.redeem-control.has-error {
  border-color: #777777;
}

.redeem-input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 10px;
  border: 0;
  outline: none;
  background: transparent;
  color: #f5f5f5;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.02em;
}

.redeem-input::placeholder {
  color: #5c5c5c;
  font-family: var(--font-sans);
  letter-spacing: 0;
}

.redeem-input:disabled {
  opacity: 0.5;
}

.redeem-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 86px;
  height: 44px;
  flex: none;
  padding: 0 16px;
  border: 1px solid #f5f5f5;
  border-radius: 2px;
  background: #f5f5f5;
  color: #050505;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
  transition:
    background-color 130ms ease,
    color 130ms ease;
}

.redeem-submit:hover:not(:disabled) {
  background: #ffffff;
}

.redeem-submit:disabled {
  opacity: 0.55;
}

.redeem-submit .spinner {
  width: 13px;
  height: 13px;
  border-width: 1px;
}

.redeem-error {
  min-height: 18px;
  margin: 10px 1px 0;
  color: #bdbdbd;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.02em;
  line-height: 1.6;
}

@media (max-width: 480px) {
  .home {
    padding: 22px;
  }

  .redeem-brand {
    margin-bottom: 30px;
  }

  .redeem-control {
    align-items: stretch;
    flex-direction: column;
    gap: 4px;
  }

  .redeem-input {
    height: 42px;
  }

  .redeem-submit {
    width: 100%;
    height: 42px;
  }
}
</style>
