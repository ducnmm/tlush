import { icon } from "../icons.js";

export const $ = (id) => document.getElementById(id);
export const html = String.raw;
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const short = (address) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
export const capitalize = (value) => value[0].toUpperCase() + value.slice(1);
export function heading(title) {
  return html`<div class="page-heading">
    <button class="back" id="back" aria-label="Back">${icon("back")}</button>
    <h2>${escape(title)}</h2>
    <span></span>
  </div>`;
}
export async function rpc(method, params = {}) {
  const response = await chrome.runtime.sendMessage({
    channel: "tlush-rpc",
    method,
    params,
  });
  if (!response || response.error)
    throw Error(response?.error || "Tlush did not respond.");
  return response.result;
}
