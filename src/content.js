import { connectionNotice } from "./notice.js";
const script = document.createElement("script");
script.src = chrome.runtime.getURL("provider.js");
(document.head || document.documentElement).append(script);
script.remove();
window.addEventListener("message", async (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== "tlush-page-request"
  )
    return;
  const { id, method, params } = event.data;
  if (typeof id !== "string" || id.length > 100) return;
  const allowed = [
    "connect",
    "disconnect",
    "signMessage",
    "signTransaction",
    "executeTransaction",
  ];
  if (!allowed.includes(method)) return;
  try {
    const response = await chrome.runtime.sendMessage({
      channel: "tlush-rpc",
      method,
      params,
    });
    window.postMessage(
      { channel: "tlush-page-response", id, ...response },
      location.origin,
    );
  } catch (error) {
    const message = error.message?.includes("Extension context invalidated")
      ? "Tlush was updated. Refresh this dApp tab, then connect again."
      : error.message;
    console.warn("[Tlush connection]", message);
    if (method === "connect") connectionNotice(message);
    window.postMessage(
      { channel: "tlush-page-response", id, error: message },
      location.origin,
    );
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.channel === "tlush-event")
    window.postMessage(message, location.origin);
});
