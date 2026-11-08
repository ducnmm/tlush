export function discardSnapshots() {
  document.querySelectorAll(".ui-snapshot").forEach((node) => node.remove());
}
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
export function prepareTransition(previous, next) {
  discardSnapshots();
  if (previous === "accounts" && next !== previous) {
    const outgoing = document.querySelector("main").cloneNode(true);
    outgoing.classList.add("ui-snapshot");
    outgoing.inert = true;
    outgoing
      .querySelectorAll("[id]")
      .forEach((node) => node.removeAttribute("id"));
    outgoing.style.zIndex = "5";
    document.body.append(outgoing);
    return outgoing;
  }
  if (next === "accounts" && previous === "home") {
    const panel = document.querySelector("main"),
      app = document.querySelector("#app");
    const background = app.cloneNode(true);
    background.style.top = `${panel.getBoundingClientRect().top - panel.scrollTop}px`;
    background.style.width = `${app.getBoundingClientRect().width}px`;
    background.className = "ui-snapshot sheet-underlay";
    background.removeAttribute("id");
    background.inert = true;
    background
      .querySelectorAll("[id]")
      .forEach((node) => node.removeAttribute("id"));
    document.body.append(background);
  }
}
export function animateTransition(previous, next, outgoing) {
  if (!reducedMotion() && previous !== next) {
    const target = document.querySelector(
      next === "accounts" ? "main" : "#app",
    );
    target.getAnimations().forEach((animation) => animation.cancel());
    target.animate(
      next === "accounts"
        ? [
            { transform: "translateY(100%)", opacity: 0.5 },
            { transform: "translateY(0)", opacity: 1 },
          ]
        : [
            { transform: "translateX(10px)", opacity: 0 },
            { transform: "translateX(0)", opacity: 1 },
          ],
      {
        duration: next === "accounts" ? 260 : 180,
        easing: "cubic-bezier(.2,.8,.2,1)",
      },
    );
  }
  if (!outgoing) return;
  if (reducedMotion()) {
    outgoing.remove();
    return;
  }
  const animation = outgoing.animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
    { duration: 180, easing: "cubic-bezier(.4,0,1,1)" },
  );
  animation.finished.catch(() => {}).finally(() => outgoing.remove());
}
