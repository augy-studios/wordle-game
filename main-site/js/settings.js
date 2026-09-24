// Player settings, kept in this browser. The name, adding solved rounds
// automatically and hard mode are set in the settings window; the word
// length is picked on the game card and remembered here.

import { api } from "./api.js";
import { openModal, store } from "./ui.js";
import { DEFAULT_LENGTH } from "./rules.js";

const STORAGE = "wordle.settings";

const DEFAULTS = { name: null, auto_submit: false, hard_mode: false, length: DEFAULT_LENGTH };

let current = null;

function load() {
  const saved = store.getJson(STORAGE) ?? {};
  const out = { ...DEFAULTS };
  if (typeof saved.name === "string" && saved.name.trim()) out.name = saved.name.trim();
  out.auto_submit = saved.auto_submit === true;
  out.hard_mode = saved.hard_mode === true;
  if (Number.isInteger(saved.length) && saved.length >= 2 && saved.length <= 32) out.length = saved.length;
  // Adding rounds automatically needs a name to add them under.
  if (!out.name) out.auto_submit = false;
  return out;
}

export function getSettings() {
  current ??= load();
  return { ...current };
}

export function saveSettings(changes) {
  current = { ...getSettings(), ...changes };
  if (!current.name) current.auto_submit = false;
  store.set(STORAGE, current);
  render();
  return getSettings();
}

const $ = (id) => document.getElementById(id);

function render() {
  const s = getSettings();
  $("clearNameBtn").classList.toggle("hidden", !s.name);
  $("savedName").textContent = `Now: ${s.name ?? "Not set"}`;

  document.querySelectorAll("#settingsModal [data-setting]").forEach((el) => {
    const on = s[el.dataset.setting];
    el.setAttribute("aria-checked", String(on));
    el.querySelector(".switch-state").textContent = on ? "On" : "Off";
  });
  const auto = document.querySelector('[data-setting="auto_submit"]');
  auto.disabled = !s.name;
  $("autoNote").classList.toggle("hidden", Boolean(s.name));
}

async function onSaveName(event) {
  event.preventDefault();
  const input = $("settingsName");
  const msg = $("nameMsg");
  const name = input.value.trim();
  if (!name) {
    msg.textContent = "Enter a name.";
    input.focus();
    return;
  }
  $("saveNameBtn").disabled = true;
  msg.textContent = "";
  try {
    // The API cleans and checks it, the same check a submission gets.
    const result = await api.checkName(name);
    saveSettings({ name: result.name });
    input.value = "";
    msg.textContent = "Saved.";
  } catch (err) {
    msg.textContent =
      err.code === "offline"
        ? "Checking a name needs a connection."
        : err.message || "That did not go through. Try again in a moment.";
  } finally {
    $("saveNameBtn").disabled = false;
  }
}

export function openSettings() {
  $("nameMsg").textContent = "";
  $("settingsName").value = "";
  render();
  openModal("settingsModal");
}

export function initSettings() {
  $("settingsBtn").addEventListener("click", openSettings);
  $("nameForm").addEventListener("submit", onSaveName);
  $("clearNameBtn").addEventListener("click", () => {
    saveSettings({ name: null });
    $("nameMsg").textContent = "Name cleared.";
  });
  document.querySelectorAll("#settingsModal [data-setting]").forEach((el) => {
    el.addEventListener("click", () => saveSettings({ [el.dataset.setting]: !getSettings()[el.dataset.setting] }));
  });
}
