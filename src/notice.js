export function connectionNotice(message) {
  const id = "tlush-connection-notice";
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute("role", "alert");
  host.style.cssText =
    "position:fixed;z-index:2147483647;bottom:20px;right:20px;width:350px;max-width:calc(100vw - 40px);background:#071e34;color:#f7fafc;border:1px solid #38dfa0;border-radius:16px;padding:18px;font:14px/1.5 system-ui;box-shadow:0 6px 30px #0007";
  const title = document.createElement("strong");
  title.textContent = "Tlush";
  host.append(title);
  const text = document.createElement("p");
  text.textContent = message;
  host.append(text);
  const button = document.createElement("button");
  const reload = /refresh|updated|context invalidated/i.test(message);
  button.textContent = reload ? "Refresh page" : "Dismiss";
  button.style.cssText =
    "border:0;border-radius:10px;background:#38dfa0;color:#071e34;padding:8px 14px;cursor:pointer";
  button.onclick = () => {
    if (reload) location.reload();
    else host.remove();
  };
  host.append(button);
  (document.body || document.documentElement).append(host);
}
