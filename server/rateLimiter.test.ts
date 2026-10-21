import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./rateLimiter";

describe("RateLimiter", () => {
  test("allows up to capacity, then blocks", () => {
    const limiter = new RateLimiter(3, 0);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
  });

  test("refills over time", async () => {
    const limiter = new RateLimiter(1, 1000); // instant-ish refill for the test
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(limiter.allow()).toBe(true);
  });

  test("never exceeds capacity", async () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.allow();
    limiter.allow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
  });
});
