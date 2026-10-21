export class RateLimiter {
  private tokens: number;
  private updatedAt = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  allow(cost = 1): boolean {
    const now = Date.now();
    const elapsed = (now - this.updatedAt) / 1_000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
