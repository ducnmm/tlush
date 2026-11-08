// Racing the work bounds callers even if a transport fails to honour cancellation.
// Work with side effects must also check signal before starting its next step.
export async function withDeadline(work, milliseconds, message) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function waitForSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
