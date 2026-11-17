import { conn } from "../api";
import { confirmDialog, esc, errMsg } from "../ui";
import type { Page } from "./page";

type Kind = "DOMAIN" | "DOMAIN-SUFFIX" | "IP-CIDR";
interface Entry { id?: string; rule_type: Kind; value: string; policy: string }
interface Job { status?: string; phase?: string; message?: string; rollback_error?: string }
interface Snapshot { entries: Entry[]; groups: string[]; revision: string; job: Job }
const labels: Record<Kind, string> = { DOMAIN: "仅此域名", "DOMAIN-SUFFIX": "域名及子域名", "IP-CIDR": "IPv4 / CIDR" };

export const forward: Page = {
  title: "强制转发",
  mount(root) {
    // Reuse the installed phone helper; never send OxiDNS credentials to this port.
    const endpoint = new URL("/api/force-forward", new URL(conn.base, location.href));
    endpoint.port = "9198";
    root.innerHTML = `<div class="fp-page">
      <p class="sub">为域名或公网 IPv4 指定现有代理组，或使用直连。复用手机已安装的强制转发服务。</p>
      <div class="fp-status" id="fp-status" role="status" aria-live="polite">正在读取规则…</div>
      <section class="card"><div class="card-h"><h2 id="fp-title">添加规则</h2><button class="btn" id="fp-refresh">刷新</button></div><div class="card-b">
        <form id="fp-form" class="fp-editor">
          <label>目标 · 每行一个<textarea id="fp-input" maxlength="65536" spellcheck="false" required placeholder="example.com&#10;api.example.com"></textarea><span class="sub" id="fp-help">只填写域名，无需协议、路径或端口。重复目标会更新出口。</span></label>
          <div class="fp-options">
            <label>匹配范围<select id="fp-kind"><option value="DOMAIN">仅此域名</option><option value="DOMAIN-SUFFIX">域名及全部子域名</option><option value="IP-CIDR">IPv4 / CIDR</option></select></label>
            <label>转发方式<select id="fp-mode"><option value="proxy">代理转发</option><option value="direct">直连 · 不走代理组</option></select></label>
            <label id="fp-group-field">代理组<select id="fp-group"></select></label>
            <button class="btn primary" id="fp-add" type="submit" disabled>添加并生效</button><button class="btn" id="fp-cancel" type="button" hidden>取消编辑</button>
          </div>
        </form><p id="fp-error" class="fp-error" role="alert"></p>
      </div></section>
      <section class="card"><div class="card-h"><h2>已添加规则 <span id="fp-count"></span></h2><input id="fp-search" type="search" placeholder="搜索目标或出口" aria-label="搜索目标或出口"></div><div class="card-b" id="fp-list" aria-busy="true"></div></section>
      <p class="sub">应用时联动 OxiDNS、Mihomo 与手机路由；移除后恢复原分流。已有连接和 DNS 缓存可能需要重连或刷新。需安装配套的 9198 强制转发服务；未安装时不会创建服务或修改配置。</p>
    </div>`;
    const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#fp-" + id)!;
    const input = el<HTMLTextAreaElement>("input"), kind = el<HTMLSelectElement>("kind"), mode = el<HTMLSelectElement>("mode"), group = el<HTMLSelectElement>("group");
    let entries: Entry[] = [], revision = "", job: Job = {}, loaded = false, sending = false, reading = false, editing = "", disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lifetime = new AbortController();
    const busy = () => sending || job.status === "running";
    const status = (text: string, error = false) => { el("status").textContent = text; el("status").classList.toggle("fp-error", error); };
    function controls() {
      for (const id of ["input", "kind", "mode", "group", "cancel", "refresh"]) (el(id) as HTMLInputElement).disabled = busy();
      el<HTMLButtonElement>("add").disabled = busy() || reading || !loaded || (mode.value === "proxy" && !group.value);
      el("add").textContent = busy() ? "正在应用…" : editing ? "保存并生效" : "添加并生效";
      el("group-field").hidden = mode.value === "direct";
      el("list").setAttribute("aria-busy", String(busy() || reading));
      root.querySelectorAll<HTMLButtonElement>("[data-edit],[data-remove]").forEach(b => b.disabled = busy() || reading || !loaded);
    }
    function resetEdit() { editing = ""; input.value = ""; el("title").textContent = "添加规则"; el("cancel").hidden = true; controls(); }
    function rows() {
      const query = el<HTMLInputElement>("search").value.trim().toLowerCase();
      const filtered = entries.filter(e => `${e.value} ${e.policy}`.toLowerCase().includes(query));
      el("count").textContent = loaded ? `· ${entries.length}` : "";
      el("list").innerHTML = !loaded && !entries.length ? '<p class="sub">尚未读取到规则，请检查服务状态。</p>' : !filtered.length ? '<p class="sub">没有匹配的规则</p>' : `<div class="fp-table-wrap"><table class="tbl"><thead><tr><th>目标</th><th>范围 / 出口</th><th>操作</th></tr></thead><tbody>${filtered.map(e => `<tr><td><code>${esc(e.value)}</code></td><td>${esc(labels[e.rule_type] ?? e.rule_type)}<br>${esc(e.policy === "DIRECT" ? "直连" : e.policy)}</td><td><button class="btn" data-edit="${esc(e.id)}">编辑</button> <button class="btn" data-remove="${esc(e.id)}">移除</button></td></tr>`).join("")}</tbody></table></div>`;
      controls();
    }
    async function api(method = "GET", body?: unknown): Promise<Snapshot> {
      const timeout = new AbortController();
      const cancel = () => timeout.abort();
      lifetime.signal.addEventListener("abort", cancel, { once: true });
      const limit = setTimeout(cancel, 12000);
      try {
        const response = await fetch(endpoint, { method, cache: "no-store", credentials: "omit", headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: timeout.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.message || `HTTP ${response.status}`);
        return data;
      } finally { clearTimeout(limit); lifetime.signal.removeEventListener("abort", cancel); }
    }
    function showJob() {
      if (job.status === "running") status(job.phase || "正在应用…");
      else if (job.status === "failed") status([job.phase, job.message, job.rollback_error].filter(Boolean).join(" · ") || "应用失败", true);
      else status(`${job.status === "succeeded" ? "已生效" : "已读取"} · ${entries.length} 条规则`);
    }
    function schedule() {
      clearTimeout(timer);
      if (!disposed && !document.hidden) timer = setTimeout(read, busy() ? 2000 : 10000);
    }
    async function read() {
      if (disposed || sending || reading) return;
      clearTimeout(timer); reading = true; controls();
      try {
        const data = await api();
        if (disposed) return;
        if (!Array.isArray(data.entries) || !Array.isArray(data.groups) || typeof data.revision !== "string") throw Error("服务返回格式不兼容");
        const previous = job.status;
        entries = data.entries; revision = data.revision; job = data.job ?? {}; loaded = true;
        const selected = group.value;
        group.innerHTML = data.groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
        if (data.groups.includes(selected)) group.value = selected;
        if (previous === "running" && job.status === "succeeded") resetEdit();
        showJob(); rows();
      } catch (e) {
        if (!disposed) { loaded = false; status("无法读取强制转发服务，请确认手机 9198 服务可连接后刷新。", true); el("error").textContent = errMsg(e); }
      } finally { reading = false; if (!disposed) { controls(); schedule(); } }
    }
    async function submit(next: Entry[]) {
      if (disposed || busy() || reading || !loaded) return;
      sending = true; clearTimeout(timer); controls(); el("error").textContent = "";
      status("正在提交规则…");
      try {
        await api("PUT", { entries: next, revision });
        if (!disposed) job = { status: "running", phase: "准备应用" };
      } catch (e) { if (!disposed) el("error").textContent = errMsg(e); }
      finally { sending = false; if (!disposed) await read(); }
    }
    function kindChanged() {
      const ip = kind.value === "IP-CIDR";
      input.placeholder = ip ? "8.8.8.8\n1.1.1.0/24" : "example.com\napi.example.com";
      el("help").textContent = ip ? "支持公网 IPv4 / CIDR；不支持内网、Fake-IP 或 IPv6。" : "只填写域名，无需协议、路径或端口。重复目标会更新出口。";
    }
    el("form").onsubmit = event => {
      event.preventDefault();
      try {
        const lines = input.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        if (!lines.length || lines.length > 200) throw Error("每次填写 1 至 200 个目标。");
        if (editing && lines.length !== 1) throw Error("编辑时仅填写一个目标；批量添加请先取消编辑。");
        const policy = mode.value === "direct" ? "DIRECT" : group.value;
        const next = entries.filter(e => e.id !== editing).map(e => ({ ...e }));
        for (let value of lines) {
          if (kind.value !== "IP-CIDR") {
            if (/[\s/:?#@*\\]/.test(value)) throw Error("请填写纯域名：" + value);
            value = new URL("http://" + value.replace(/\.$/, "")).hostname.toLowerCase();
            if (!value || !/^[a-z0-9.-]+$/.test(value)) throw Error("域名无效");
          }
          const existing = next.find(e => e.rule_type === kind.value && e.value === value);
          if (existing) existing.policy = policy;
          else next.push({ ...(editing ? { id: editing } : {}), rule_type: kind.value as Kind, value, policy });
        }
        void submit(next);
      } catch (e) { el("error").textContent = errMsg(e); }
    };
    el("list").onclick = async event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-edit],[data-remove]");
      if (!button || busy() || reading || !loaded) return;
      const entry = entries.find(e => e.id === (button.dataset.edit ?? button.dataset.remove));
      if (!entry) return;
      if (button.hasAttribute("data-remove")) {
        if (await confirmDialog({ title: "移除强制转发规则？", body: `${esc(entry.value)} 将恢复原分流。`, ok: "移除", danger: true })) void submit(entries.filter(e => e.id !== entry.id));
      } else {
        editing = entry.id!; kind.value = entry.rule_type; mode.value = entry.policy === "DIRECT" ? "direct" : "proxy";
        if (entry.policy !== "DIRECT") group.value = entry.policy;
        kindChanged(); input.value = entry.value; el("title").textContent = "编辑规则"; el("cancel").hidden = false; controls(); input.focus();
      }
    };
    el("kind").onchange = kindChanged; el("mode").onchange = controls; el("cancel").onclick = resetEdit;
    el("refresh").onclick = () => void read(); el("search").oninput = rows;
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", visibility);
    rows(); void read();
    return () => { disposed = true; clearTimeout(timer); lifetime.abort(); document.removeEventListener("visibilitychange", visibility); };
  },
};
