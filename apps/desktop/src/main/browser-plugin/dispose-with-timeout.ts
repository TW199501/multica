// Settles once dispose finishes, fails, or the deadline passes, whichever
// comes first. Never rejects, so callers can always continue quitting.
export async function disposeWithTimeout(
  dispose: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve().then(dispose), deadline]);
  } catch (err) {
    console.warn("[orca-browser] dispose failed", err);
  } finally {
    clearTimeout(timer);
  }
}
