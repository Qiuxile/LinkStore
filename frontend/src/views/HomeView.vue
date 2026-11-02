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

    if (result.type === "redirect" && result.targetUrl && isSafeHttpUrl(result.targetUrl)) {
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
    <div class="home-orbit home-orbit-one" aria-hidden="true"></div>
    <div class="home-orbit home-orbit-two" aria-hidden="true"></div>

    <section class="redeem-card" aria-labelledby="linkstore-title">
      <div class="brand redeem-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8 5h10v3h-7v8h7v3H8V5Z" fill="currentColor" />
            <path d="M4 8h2.5v8H4V8Z" fill="currentColor" opacity=".55" />
          </svg>
        </span>
        <span id="linkstore-title">LinkStore</span>
      </div>

      <form class="redeem-form" novalidate @submit.prevent="submit">
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
            <span>{{ isSubmitting ? "验证中" : "兑换并前往" }}</span>
            <svg
              v-if="!isSubmitting"
              class="submit-arrow"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 10h11m-4-4 4 4-4 4"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
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
  position: relative;
  display: grid;
  min-height: 100svh;
  padding: 28px;
  overflow: hidden;
  place-items: center;
  background:
    radial-gradient(circle at 16% 18%, rgba(198, 229, 214, 0.62), transparent 32%),
    radial-gradient(circle at 84% 82%, rgba(227, 213, 181, 0.54), transparent 34%),
    linear-gradient(145deg, #f7f5ef 0%, #f0eee5 52%, #f5f2e9 100%);
}

.home::after {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(27, 44, 34, 0.09) 0.65px, transparent 0.65px);
  background-size: 18px 18px;
  content: "";
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.3), transparent 60%);
  pointer-events: none;
}

.home-orbit {
  position: absolute;
  border: 1px solid rgba(11, 107, 79, 0.13);
  border-radius: 50%;
  pointer-events: none;
}

.home-orbit-one {
  width: min(78vw, 760px);
  aspect-ratio: 1;
  top: -58%;
  right: -18%;
}

.home-orbit-two {
  width: min(58vw, 530px);
  aspect-ratio: 1;
  bottom: -46%;
  left: -16%;
  border-color: rgba(126, 102, 55, 0.12);
}

.redeem-card {
  position: relative;
  z-index: 1;
  width: min(100%, 430px);
  padding: 42px 38px 32px;
  border: 1px solid rgba(255, 255, 255, 0.84);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 28px 70px rgba(42, 54, 45, 0.12);
  backdrop-filter: blur(22px);
  animation: card-in 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

.redeem-brand {
  justify-content: center;
  margin-bottom: 34px;
}

.redeem-brand .brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 12px;
}

.redeem-brand .brand-mark svg {
  width: 21px;
  height: 21px;
}

.redeem-form {
  width: 100%;
}

.redeem-control {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px;
  border: 1px solid rgba(23, 33, 28, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 3px 10px rgba(28, 40, 33, 0.04);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.redeem-control:focus-within {
  border-color: rgba(11, 107, 79, 0.58);
  box-shadow:
    0 0 0 4px rgba(11, 107, 79, 0.09),
    0 6px 18px rgba(28, 40, 33, 0.07);
}

.redeem-control.has-error {
  border-color: rgba(169, 61, 61, 0.5);
}

.redeem-input {
  width: 100%;
  min-width: 0;
  height: 46px;
  padding: 0 8px 0 12px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 16px;
  letter-spacing: 0.005em;
}

.redeem-input::placeholder {
  color: #929b95;
  letter-spacing: 0;
}

.redeem-input:disabled {
  opacity: 0.62;
}

.redeem-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 124px;
  height: 46px;
  flex: none;
  padding: 0 15px;
  border: 0;
  border-radius: 11px;
  background: var(--accent);
  box-shadow: 0 8px 18px rgba(11, 107, 79, 0.2);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.redeem-submit:hover:not(:disabled) {
  background: var(--accent-strong);
  box-shadow: 0 10px 22px rgba(11, 107, 79, 0.26);
}

.redeem-submit:active:not(:disabled) {
  transform: translateY(1px);
}

.redeem-submit:disabled {
  opacity: 0.8;
}

.submit-arrow {
  width: 17px;
  height: 17px;
  margin-left: 1px;
}

.redeem-error {
  min-height: 20px;
  margin: 12px 4px 0;
  color: var(--danger);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

@media (max-width: 520px) {
  .home {
    padding: 20px;
  }

  .redeem-card {
    padding: 34px 22px 24px;
    border-radius: 24px;
  }

  .redeem-brand {
    margin-bottom: 28px;
  }

  .redeem-control {
    flex-direction: column;
    align-items: stretch;
    padding: 7px;
  }

  .redeem-input {
    height: 44px;
  }

  .redeem-submit {
    width: 100%;
    height: 44px;
  }
}
</style>
