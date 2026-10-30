// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeWithTimeout } from "./dispose-with-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("disposeWithTimeout", () => {
  it("resolves when dispose resolves", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    await expect(disposeWithTimeout(dispose, 10_000)).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves after the timeout when dispose hangs", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = disposeWithTimeout(() => new Promise<void>(() => {}), 500).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it("resolves when dispose rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      disposeWithTimeout(() => Promise.reject(new Error("boom")), 10_000),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
