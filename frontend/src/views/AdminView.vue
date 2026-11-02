<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ApiError,
  createCode,
  deleteCode,
  getCodes,
  getSession,
  logout,
  updateCode,
} from "../api";
import type {
  AdminCode,
  CodeFormValues,
  CreateCodePayload,
} from "../types";
import CodeFormModal from "../components/CodeFormModal.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import GeneratedCodeDialog from "../components/GeneratedCodeDialog.vue";

type BadgeTone = "ok" | "muted" | "warn" | "danger";

const booting = ref(true);
const bootError = ref("");
const codes = ref<AdminCode[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loadingCodes = ref(false);
const actionError = ref("");
const actionNotice = ref("");
const loggingOut = ref(false);

const formOpen = ref(false);
const formMode = ref<"create" | "edit">("create");
const editingCode = ref<AdminCode | null>(null);
const formSubmitting = ref(false);
const formError = ref("");

const generated = ref<{ code: string; targetUrl: string } | null>(null);

const deleteTarget = ref<AdminCode | null>(null);
const deleting = ref(false);
const deleteError = ref("");
const busyId = ref<number | null>(null);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return dateFormatter.format(date);
}

function statusOf(code: AdminCode): { label: string; tone: BadgeTone } {
  if (code.disabled) return { label: "已停用", tone: "muted" };
  if (
    code.expiresAt &&
    new Date(code.expiresAt).getTime() <= Date.now()
  ) {
    return { label: "已过期", tone: "danger" };
  }
  if (code.usedCount >= code.maxUses) {
    return { label: "已用尽", tone: "warn" };
  }
  return { label: "可用", tone: "ok" };
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function redirectHome(): void {
  window.location.replace("/");
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      NETWORK_ERROR: "网络异常，请检查连接后重试。",
      INVALID_ORIGIN: "安全校验失败，请刷新页面后重试。",
      INVALID_TARGET_URL: "目标地址无效，只允许 http:// 或 https://。",
      INVALID_MAX_USES: "最大使用次数无效。",
      INVALID_EXPIRY: "过期时间必须晚于当前时间。",
      INVALID_CODE_FORMAT: "自定义兑换码长度需为 8 到 128 个字符。",
      CODE_EXISTS: "该兑换码已存在，请换一个。",
      CODE_RESERVED: "该兑换码不可用，请换一个。",
      MAX_USES_BELOW_USED: "最大使用次数不能小于已使用次数。",
      CODE_NOT_FOUND: "兑换码不存在，可能已被删除。",
      CODE_UPDATE_CONFLICT: "兑换码已被其他操作修改，请刷新后重试。",
      UNAUTHORIZED: "会话已失效，请重新登录。",
    };
    return messages[error.code] ?? "操作失败，请稍后重试。";
  }
  return "操作失败，请稍后重试。";
}

async function loadCodes(): Promise<void> {
  loadingCodes.value = true;
  try {
    const response = await getCodes(page.value, pageSize);
    codes.value = response.items;
    total.value = response.pagination.total;

    if (page.value > totalPages.value) {
      page.value = totalPages.value;
      const retry = await getCodes(page.value, pageSize);
      codes.value = retry.items;
      total.value = retry.pagination.total;
    }
  } catch (error) {
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    actionError.value = friendlyError(error);
  } finally {
    loadingCodes.value = false;
  }
}

async function boot(): Promise<void> {
  booting.value = true;
  bootError.value = "";
  try {
    await getSession();
    booting.value = false;
    await loadCodes();
  } catch (error) {
    booting.value = false;
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    bootError.value = friendlyError(error);
  }
}

function onPageShow(event: PageTransitionEvent): void {
  // A page restored from the back-forward cache must revalidate its session.
  if (event.persisted) void boot();
}

onMounted(() => {
  window.addEventListener("pageshow", onPageShow);
  void boot();
});

onBeforeUnmount(() => {
  window.removeEventListener("pageshow", onPageShow);
});

function openCreate(): void {
  formMode.value = "create";
  editingCode.value = null;
  formError.value = "";
  formOpen.value = true;
}

function openEdit(code: AdminCode): void {
  formMode.value = "edit";
  editingCode.value = code;
  formError.value = "";
  formOpen.value = true;
}

function closeForm(): void {
  if (formSubmitting.value) return;
  formOpen.value = false;
  formError.value = "";
}

async function submitCodeForm(values: CodeFormValues): Promise<void> {
  if (formSubmitting.value) return;
  formSubmitting.value = true;
  formError.value = "";
  actionError.value = "";
  actionNotice.value = "";

  try {
    if (formMode.value === "create") {
      const payload: CreateCodePayload = {
        targetUrl: values.targetUrl,
        maxUses: values.maxUses,
        expiresAt: values.expiresAt,
      };
      if (values.code) payload.code = values.code;

      const response = await createCode(payload);
      formOpen.value = false;
      generated.value = {
        code: response.code,
        targetUrl: response.item.targetUrl,
      };
      page.value = 1;
      await loadCodes();
    } else if (editingCode.value) {
      const updated = await updateCode(editingCode.value.id, {
        targetUrl: values.targetUrl,
        maxUses: values.maxUses,
        expiresAt: values.expiresAt,
        disabled: values.disabled,
      });
      formOpen.value = false;
      actionNotice.value = `兑换码 #${updated.item.id} 已更新。`;
      await loadCodes();
    }
  } catch (error) {
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    formError.value = friendlyError(error);
  } finally {
    formSubmitting.value = false;
  }
}

async function toggleCode(code: AdminCode): Promise<void> {
  if (busyId.value !== null) return;
  busyId.value = code.id;
  actionError.value = "";
  actionNotice.value = "";

  try {
    await updateCode(code.id, { disabled: !code.disabled });
    actionNotice.value = code.disabled
      ? `兑换码 #${code.id} 已启用。`
      : `兑换码 #${code.id} 已停用。`;
    await loadCodes();
  } catch (error) {
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    actionError.value = friendlyError(error);
  } finally {
    busyId.value = null;
  }
}

function openDelete(code: AdminCode): void {
  deleteTarget.value = code;
  deleteError.value = "";
}

function closeDelete(): void {
  if (deleting.value) return;
  deleteTarget.value = null;
  deleteError.value = "";
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target || deleting.value) return;

  deleting.value = true;
  deleteError.value = "";
  try {
    await deleteCode(target.id);
    deleteTarget.value = null;
    if (codes.value.length === 1 && page.value > 1) page.value -= 1;
    actionNotice.value = `兑换码 #${target.id} 已删除。`;
    await loadCodes();
  } catch (error) {
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    deleteError.value = friendlyError(error);
  } finally {
    deleting.value = false;
  }
}

async function previousPage(): Promise<void> {
  if (page.value <= 1 || loadingCodes.value) return;
  page.value -= 1;
  await loadCodes();
}

async function nextPage(): Promise<void> {
  if (page.value >= totalPages.value || loadingCodes.value) return;
  page.value += 1;
  await loadCodes();
}

async function handleLogout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  actionError.value = "";
  try {
    await logout();
    redirectHome();
  } catch (error) {
    if (isUnauthorized(error)) {
      redirectHome();
      return;
    }
    actionError.value = friendlyError(error);
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div v-if="booting" class="admin-boot">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8 5h10v3h-7v8h7v3H8V5Z" fill="currentColor" />
          <path d="M4 8h2.5v8H4V8Z" fill="currentColor" opacity=".55" />
        </svg>
      </span>
      <span>LinkStore</span>
    </div>
    <div class="boot-card">
      <span class="spinner" aria-hidden="true"></span>
      <p>正在验证管理会话</p>
    </div>
  </div>

  <div v-else-if="bootError" class="admin-boot">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8 5h10v3h-7v8h7v3H8V5Z" fill="currentColor" />
          <path d="M4 8h2.5v8H4V8Z" fill="currentColor" opacity=".55" />
        </svg>
      </span>
      <span>LinkStore</span>
    </div>
    <div class="boot-card boot-error-card">
      <h1>无法载入控制台</h1>
      <p>{{ bootError }}</p>
      <div class="boot-actions">
        <button class="btn btn-secondary" type="button" @click="boot">重试</button>
        <button class="btn btn-primary" type="button" @click="redirectHome">
          返回首页
        </button>
      </div>
    </div>
  </div>

  <div v-else class="admin-page">
    <header class="admin-header">
      <div class="admin-header-inner">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M8 5h10v3h-7v8h7v3H8V5Z" fill="currentColor" />
              <path d="M4 8h2.5v8H4V8Z" fill="currentColor" opacity=".55" />
            </svg>
          </span>
          <span>LinkStore</span>
        </div>

        <div class="header-actions">
          <span class="admin-role">管理控制台</span>
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="loggingOut"
            @click="handleLogout"
          >
            <span v-if="loggingOut" class="spinner" aria-hidden="true"></span>
            <span>退出</span>
          </button>
        </div>
      </div>
    </header>

    <main class="admin-main">
      <section class="admin-hero">
        <div>
          <p class="eyebrow">Link management</p>
          <h1>兑换码</h1>
          <p class="hero-description">
            配置跳转目标、使用次数与有效期，并跟踪每一次兑换。
          </p>
        </div>
        <button class="btn btn-primary create-button" type="button" @click="openCreate">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          新建兑换码
        </button>
      </section>

      <div v-if="actionError" class="banner banner-error admin-banner" role="alert">
        <span>{{ actionError }}</span>
        <button class="banner-close" type="button" aria-label="关闭" @click="actionError = ''">×</button>
      </div>
      <div v-if="actionNotice" class="banner banner-success admin-banner" role="status">
        <span>{{ actionNotice }}</span>
        <button class="banner-close" type="button" aria-label="关闭" @click="actionNotice = ''">×</button>
      </div>

      <section class="panel">
        <header class="panel-header">
          <div>
            <h2>全部兑换码</h2>
            <p>共 {{ total }} 个，兑换码明文不保存在数据库中。</p>
          </div>
          <button
            class="btn btn-secondary btn-small"
            type="button"
            :disabled="loadingCodes"
            @click="loadCodes"
          >
            <span v-if="loadingCodes" class="spinner" aria-hidden="true"></span>
            <span>刷新</span>
          </button>
        </header>

        <div v-if="loadingCodes" class="panel-state">
          <span class="spinner" aria-hidden="true"></span>
          <p>正在加载兑换码</p>
        </div>

        <div v-else-if="codes.length === 0" class="panel-state empty-state">
          <div class="empty-mark" aria-hidden="true">+</div>
          <h3>还没有兑换码</h3>
          <p>创建一个兑换码，用户即可通过首页跳转到目标地址。</p>
          <button class="btn btn-secondary" type="button" @click="openCreate">
            新建第一个兑换码
          </button>
        </div>

        <div v-else class="table-wrap">
          <table>
            <caption class="sr-only">兑换码列表</caption>
            <thead>
              <tr>
                <th scope="col">编号</th>
                <th scope="col">目标地址</th>
                <th scope="col">使用次数</th>
                <th scope="col">状态</th>
                <th scope="col">创建 / 过期</th>
                <th scope="col">最后使用</th>
                <th scope="col" class="actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="code in codes" :key="code.id">
                <td class="id-cell">#{{ code.id }}</td>
                <td>
                  <span class="target-url" :title="code.targetUrl">{{ code.targetUrl }}</span>
                </td>
                <td>
                  <div class="usage-cell">
                    <div class="usage-numbers">
                      <strong>{{ code.usedCount }}</strong>
                      <span>/ {{ code.maxUses }}</span>
                    </div>
                    <progress
                      class="usage-progress"
                      :value="code.usedCount"
                      :max="code.maxUses"
                      :aria-label="`已使用 ${code.usedCount} 次，共 ${code.maxUses} 次`"
                    ></progress>
                  </div>
                </td>
                <td>
                  <span class="badge" :class="`badge-${statusOf(code).tone}`">
                    {{ statusOf(code).label }}
                  </span>
                </td>
                <td class="date-cell">
                  <span>创建 {{ formatDate(code.createdAt) }}</span>
                  <span class="date-secondary">
                    过期 {{ code.expiresAt ? formatDate(code.expiresAt) : "永不过期" }}
                  </span>
                </td>
                <td class="date-cell">
                  <span>{{ code.lastUsedAt ? formatDate(code.lastUsedAt) : "从未使用" }}</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-small" type="button" @click="openEdit(code)">
                      编辑
                    </button>
                    <button
                      class="btn btn-ghost btn-small"
                      type="button"
                      :disabled="busyId !== null"
                      @click="toggleCode(code)"
                    >
                      <span v-if="busyId === code.id" class="spinner" aria-hidden="true"></span>
                      <span>{{ code.disabled ? "启用" : "停用" }}</span>
                    </button>
                    <button class="btn btn-danger btn-small" type="button" @click="openDelete(code)">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer v-if="total > 0 && !loadingCodes" class="panel-footer">
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <div class="pagination">
            <button
              class="btn btn-secondary btn-small"
              type="button"
              :disabled="page <= 1"
              @click="previousPage"
            >
              上一页
            </button>
            <button
              class="btn btn-secondary btn-small"
              type="button"
              :disabled="page >= totalPages"
              @click="nextPage"
            >
              下一页
            </button>
          </div>
        </footer>
      </section>

      <p class="admin-footnote">
        管理会话默认 2 小时有效；管理码轮换后，所有旧会话立即失效。
      </p>
    </main>

    <CodeFormModal
      v-if="formOpen"
      :mode="formMode"
      :initial="editingCode"
      :submitting="formSubmitting"
      :server-error="formError"
      @close="closeForm"
      @submit="submitCodeForm"
    />

    <GeneratedCodeDialog
      v-if="generated"
      :code="generated.code"
      :target-url="generated.targetUrl"
      @close="generated = null"
    />

    <ConfirmDialog
      v-if="deleteTarget"
      title="删除兑换码"
      :message="`确定删除兑换码 #${deleteTarget.id} 吗？此操作不可撤销，用户将无法再使用该兑换码。`"
      :busy="deleting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.admin-page {
  min-height: 100svh;
  background:
    radial-gradient(circle at 90% -10%, rgba(205, 230, 217, 0.65), transparent 30%),
    linear-gradient(180deg, #f7f5ef 0%, var(--canvas) 42%, #f1efe7 100%);
}

.admin-header {
  position: sticky;
  z-index: 20;
  top: 0;
  border-bottom: 1px solid rgba(23, 33, 28, 0.09);
  background: rgba(247, 245, 239, 0.86);
  backdrop-filter: blur(18px);
}

.admin-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(100%, 1220px);
  min-height: 68px;
  margin: 0 auto;
  padding: 0 32px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-role {
  padding-right: 14px;
  border-right: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.admin-main {
  width: min(100%, 1220px);
  margin: 0 auto;
  padding: 52px 32px 64px;
}

.admin-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 30px;
}

.eyebrow {
  margin: 0 0 9px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.admin-hero h1 {
  margin: 0;
  color: var(--ink);
  font-size: clamp(34px, 4vw, 48px);
  font-weight: 660;
  letter-spacing: -0.045em;
  line-height: 1.06;
}

.hero-description {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}

.create-button {
  min-height: 44px;
  padding: 0 18px;
  white-space: nowrap;
}

.create-button svg {
  width: 17px;
  height: 17px;
}

.admin-banner {
  margin-bottom: 14px;
}

.panel {
  overflow: hidden;
  border: 1px solid rgba(23, 33, 28, 0.1);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.87);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.8) inset,
    0 18px 48px rgba(28, 40, 33, 0.065);
  backdrop-filter: blur(10px);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px;
  border-bottom: 1px solid var(--line);
}

.panel-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.panel-header p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.btn-small {
  min-height: 32px;
  padding: 0 11px;
  border-radius: 8px;
  font-size: 12px;
}

.btn-small .spinner {
  width: 13px;
  height: 13px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  text-align: left;
}

th {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(250, 249, 245, 0.8);
  color: var(--faint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  white-space: nowrap;
}

th:first-child,
td:first-child {
  padding-left: 24px;
}

th:last-child,
td:last-child {
  padding-right: 24px;
}

td {
  padding: 15px 16px;
  border-bottom: 1px solid rgba(23, 33, 28, 0.075);
  vertical-align: middle;
  font-size: 13px;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr {
  transition: background-color 130ms ease;
}

tbody tr:hover {
  background: rgba(240, 248, 244, 0.48);
}

.id-cell {
  color: var(--faint);
  font-family:
    "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
}

.target-url {
  display: block;
  max-width: 250px;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-cell {
  width: 118px;
}

.usage-numbers {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 7px;
  font-variant-numeric: tabular-nums;
}

.usage-numbers strong {
  font-size: 14px;
  font-weight: 680;
}

.usage-numbers span {
  color: var(--muted);
  font-size: 11px;
}

.usage-progress {
  display: block;
  width: 100%;
  height: 5px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  appearance: none;
  background: #edede7;
}

.usage-progress::-webkit-progress-bar {
  border-radius: 999px;
  background: #edede7;
}

.usage-progress::-webkit-progress-value {
  border-radius: 999px;
  background: var(--accent);
}

.usage-progress::-moz-progress-bar {
  border-radius: 999px;
  background: var(--accent);
}

.date-cell {
  display: table-cell;
  min-width: 145px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
  white-space: nowrap;
}

.date-cell > span {
  display: block;
}

.date-secondary {
  color: var(--faint);
}

.actions-heading {
  text-align: right;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  white-space: nowrap;
}

.panel-state {
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 24px;
  color: var(--muted);
  text-align: center;
}

.panel-state p {
  margin: 0;
  font-size: 13px;
}

.panel-state .spinner {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.empty-state h3 {
  margin: 2px 0 0;
  color: var(--ink);
  font-size: 17px;
  letter-spacing: -0.02em;
}

.empty-state p {
  max-width: 360px;
  margin-bottom: 8px;
  line-height: 1.6;
}

.empty-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px dashed rgba(11, 107, 79, 0.32);
  border-radius: 13px;
  background: var(--accent-faint);
  color: var(--accent);
  font-size: 23px;
  font-weight: 300;
}

.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  background: rgba(250, 249, 245, 0.72);
  color: var(--muted);
  font-size: 12px;
}

.pagination {
  display: flex;
  gap: 8px;
}

.admin-footnote {
  margin: 20px 2px 0;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
}

.admin-boot {
  display: flex;
  min-height: 100svh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 28px;
  background:
    radial-gradient(circle at 20% 15%, rgba(198, 229, 214, 0.58), transparent 30%),
    linear-gradient(145deg, #f7f5ef, #f0eee5);
}

.boot-card {
  display: flex;
  width: min(100%, 390px);
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-md);
  color: var(--muted);
  backdrop-filter: blur(16px);
}

.boot-card .spinner {
  color: var(--accent);
}

.boot-card p {
  margin: 0;
  font-size: 13px;
}

.boot-error-card {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 28px;
}

.boot-error-card h1 {
  margin: 0;
  color: var(--ink);
  font-size: 21px;
  letter-spacing: -0.03em;
}

.boot-error-card p {
  margin: 0 0 8px;
  line-height: 1.6;
}

.boot-actions {
  display: flex;
  gap: 9px;
}

@media (max-width: 720px) {
  .admin-header-inner {
    min-height: 62px;
    padding: 0 18px;
  }

  .admin-role {
    display: none;
  }

  .admin-main {
    padding: 36px 18px 44px;
  }

  .admin-hero {
    align-items: flex-start;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 24px;
  }

  .create-button {
    width: 100%;
  }

  .panel-header {
    align-items: flex-start;
    padding: 18px;
  }

  .panel-footer {
    padding: 13px 18px;
  }

  th:first-child,
  td:first-child {
    padding-left: 18px;
  }

  th:last-child,
  td:last-child {
    padding-right: 18px;
  }

  .target-url {
    max-width: 210px;
  }
}
</style>
