// Visual style + light/dark mode, persisted per browser.
import { esc, icon } from "./ui";

export const STYLES = [
  { id: "shadcn", name: "极简", desc: "shadcn / Vercel 风，黑白灰 + 细边框" },
  { id: "bento", name: "便当格", desc: "Bento 拼贴，大号数字与色块" },
  { id: "liquid", name: "液态玻璃", desc: "苹果 Liquid Glass，柔光磨砂" },
  { id: "brutal", name: "新野兽派", desc: "粗描边、硬阴影、撞色" },
  { id: "classic", name: "经典", desc: "青绿色控制台" },
] as const;
export type StyleId = (typeof STYLES)[number]["id"];
export type Mode = "light" | "dark" | "auto";

const K_STYLE = "oxidns-dashboard.style";
const K_MODE = "oxidns-dashboard.theme";
const DEFAULT_STYLE: StyleId = "liquid";

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const mq = matchMedia("(prefers-color-scheme: light)");
const listeners = new Set<() => void>();
let style: StyleId = STYLES.find(x => x.id === read(K_STYLE))?.id ?? DEFAULT_STYLE;
const savedMode = read(K_MODE);
let mode: Mode = savedMode === "light" || savedMode === "dark" ? savedMode : "auto";

export function getStyle(): StyleId {
  return style;
}
export function getMode(): Mode {
  return mode;
}
export const resolvedMode = () => {
  const m = getMode();
  return m === "auto" ? (mq.matches ? "light" : "dark") : m;
};

export function apply() {
  const el = document.documentElement;
  const st = getStyle();
  if (st === "classic") delete el.dataset.style;
  else el.dataset.style = st;
  el.dataset.theme = resolvedMode();
  listeners.forEach((f) => f());
}

export function setStyle(s: StyleId) {
  if (!STYLES.some(x => x.id === s)) return;
  style = s;
  write(K_STYLE, s);
  apply();
}
export function setMode(m: Mode) {
  if (!["light", "dark", "auto"].includes(m)) return;
  mode = m;
  write(K_MODE, m);
  apply();
}
export const onChange = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function initAppearance() {
  apply();
  mq.addEventListener?.("change", () => getMode() === "auto" && apply());
}

/** Picker markup used by both the header popover and the System page. */
export function pickerHtml() {
  const st = getStyle(), m = getMode();
  return `<h5>风格</h5><div class="style-grid">${STYLES.map(
    (s) => `<button type="button" aria-pressed="${s.id === st}" class="style-opt ${s.id === st ? "on" : ""}" data-style-pick="${s.id}"><div class="swatch sw-${s.id}"><i></i><i></i><i></i></div><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></button>`,
  ).join("")}</div>
  <h5>明暗</h5><div class="seg full">${(
    [
      ["light", "sun", "浅色"],
      ["dark", "moon", "深色"],
      ["auto", "monitor", "跟随系统"],
    ] as const
  )
    .map(([k, ic, l]) => `<button type="button" aria-pressed="${m === k}" data-mode-pick="${k}" class="${m === k ? "on" : ""}">${icon(ic)}${l}</button>`)
    .join("")}</div>`;
}

/** Wire clicks inside a container rendered with pickerHtml(). */
export function bindPicker(root: HTMLElement, rerender: () => void) {
  root.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const t = e.target;
    const s = t.closest("[data-style-pick]") as HTMLElement | null;
    if (s) {
      setStyle(s.dataset.stylePick as StyleId);
      rerender();
    }
    const m = t.closest("[data-mode-pick]") as HTMLElement | null;
    if (m) {
      setMode(m.dataset.modePick as Mode);
      rerender();
    }
  });
}

/** Header popover anchored under a button. */
let closePopover: (() => void) | undefined;
export function openPopover(anchor: HTMLElement) {
  if (closePopover) { closePopover(); return; }
  const events = new AbortController();
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "外观风格");
  anchor.setAttribute("aria-expanded", "true");
  const render = () => (pop.innerHTML = pickerHtml());
  render();
  bindPicker(pop, render);
  document.body.appendChild(pop);
  const position = () => {
    const r = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 100));
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`;
    pop.style.maxHeight = `${Math.max(60, window.innerHeight - top - 8)}px`;
  };
  position();
  requestAnimationFrame(() => pop.classList.add("in"));
  closePopover = () => {
    events.abort(); pop.remove(); anchor.setAttribute("aria-expanded", "false"); closePopover = undefined;
  };
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent ? e.key !== "Escape" : pop.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closePopover?.();
  };
  document.addEventListener("pointerdown", close, { signal: events.signal });
  document.addEventListener("keydown", close, { signal: events.signal });
  window.addEventListener("resize", position, { signal: events.signal });
  window.addEventListener("hashchange", () => closePopover?.(), { signal: events.signal });
}
