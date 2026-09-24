import { icon } from "./icons.js";

// Safe to call repeatedly; re-renders when data-icon changes.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    if (el.dataset.iconRendered === name) return;
    el.innerHTML = icon(name);
    el.dataset.iconRendered = name;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Local storage that never throws. Private browsing, blocked site data and
// a full quota all read as "nothing saved" rather than a broken page.
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  getJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      // Kept for this page view only.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
};

// Focus goes into the modal on open and back to the opener on close.
const openers = new Map();

export function openModal(id) {
  const backdrop = document.getElementById(id);
  openers.set(id, document.activeElement);
  backdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
  backdrop.querySelector("button, [href], input")?.focus();
}

export function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }
  openers.get(id)?.focus?.();
  openers.delete(id);
}

export function closeTopModal() {
  const open = [...document.querySelectorAll(".modal-backdrop:not(.hidden)")].pop();
  if (!open) return false;
  closeModal(open.id);
  return true;
}

export const isModalOpen = () => document.body.classList.contains("modal-open");
