import { escape, html } from "./dom.js";
import { icon } from "../icons.js";
export function activityMarkup(items) {
  if (!items.length)
    return html`<div class="activity-empty">
      <span>${icon("activity")}</span>
      <h3>No activity yet</h3>
      <p>Your wallet activity will appear here.</p>
    </div>`;
  const groups = new Map();
  for (const a of [...items].sort((a, b) => b.at - a.at)) {
    const date = new Date(a.at);
    const month = date.toLocaleDateString("en-US", {
      month: "long",
      ...(date.getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" }
        : {}),
    });
    if (!groups.has(month)) groups.set(month, []);
    const message = /(PersonalMessage|signMessage)/i.test(a.method);
    const executed = /execute/i.test(a.method);
    const failed = a.status === "error";
    const label = message
      ? failed
        ? "Message request"
        : "Signed message"
      : executed || failed
        ? "Transaction"
        : "Signed transaction";
    const status = failed ? "Failed" : executed ? "Executed" : "Signed";
    let host;
    try {
      host = new URL(a.origin).hostname;
    } catch {
      host = a.origin || "Connected app";
    }
    const day = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    groups.get(month).push(
      html`<details
        data-activity-id="${escape(a.id || `${a.at}:${a.method}:${a.origin}`)}"
        class="transaction-card ${failed ? "failed" : ""}"
      >
        <summary>
          <span class="transaction-icon"
            >${icon(message ? "key" : "activity")}<span
              class="transaction-badge"
              >${icon(failed ? "close" : "check")}</span
            ></span
          ><span class="transaction-content"
            ><span class="transaction-title">${label}</span
            ><span class="transaction-origin">${escape(host)}</span
            ><time datetime="${date.toISOString()}">${day}</time></span
          ><span class="transaction-status">${status}</span>
        </summary>
        <div class="transaction-detail">
          <p>${escape(a.origin)}</p>
          ${a.digest ? `<p>Transaction ID</p><p class="detail-value">${escape(a.digest)}</p>` : ""}${a.error ? `<p class="transaction-error">${escape(a.error)}</p>` : ""}
          <p>${escape(date.toLocaleString())}</p>
        </div>
      </details>`,
    );
  }
  return [...groups]
    .map(
      ([month, cards]) =>
        `<div class="activity-month"><h3>${escape(month)}</h3>${cards.join("")}</div>`,
    )
    .join("");
}
