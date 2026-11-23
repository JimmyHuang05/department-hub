function createRateLimiter({ windowMs, max, keyGenerator, message = '操作过于频繁，请稍后再试' }) {
  const buckets = new Map();

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size <= 10000) return;
    const oldest = [...buckets.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
      .slice(0, buckets.size - 10000);
    oldest.forEach(([key]) => buckets.delete(key));
  }

  const middleware = (req, res, next) => {
    const now = Date.now();
    prune(now);
    const key = String(keyGenerator?.(req) || req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    return next();
  };

  middleware.reset = () => buckets.clear();
  return middleware;
}

module.exports = { createRateLimiter };
