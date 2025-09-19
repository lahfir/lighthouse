/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview WebStatus API client for fetching Baseline status
 */

/**
 * @typedef {{
 *   feature_id: string,
 *   baseline: {
 *     status: 'limited' | 'newly' | 'widely',
 *     low_date?: string,
 *     high_date?: string
 *   }
 * }} WebStatusFeature
 */

/**
 * @typedef {{
 *   status: 'limited' | 'newly' | 'widely' | 'unknown',
 *   low_date?: string,
 *   high_date?: string
 * }} BaselineStatus
 */

const API_BASE = "https://api.webstatus.dev/v1";
const BATCH_SIZE = 20;
const REQUEST_TIMEOUT = 5000;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

// In-memory cache for the duration of the run
const cache = new Map();

// Circuit breaker state
let circuitBreakerState = {
  failureCount: 0,
  lastFailureTime: 0,
  state: "closed", // 'closed', 'open', 'half-open'
};

// Cache hit/miss tracking
let cacheStats = {
  hits: 0,
  misses: 0,
};

/**
 * Sleep for a given duration with jitter
 * @param {number} ms
 * @return {Promise<void>}
 */
function sleep(ms) {
  const jitter = Math.random() * 200 - 100; // ±100ms jitter
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Check if circuit breaker should allow requests
 * @return {boolean}
 */
function shouldAllowRequest() {
  const now = Date.now();

  if (circuitBreakerState.state === "closed") {
    return true;
  }

  if (circuitBreakerState.state === "open") {
    if (now - circuitBreakerState.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreakerState.state = "half-open";
      return true;
    }
    return false;
  }

  // half-open state
  return true;
}

/**
 * Record success for circuit breaker
 */
function recordSuccess() {
  circuitBreakerState.failureCount = 0;
  circuitBreakerState.state = "closed";
}

/**
 * Record failure for circuit breaker
 */
function recordFailure() {
  circuitBreakerState.failureCount++;
  circuitBreakerState.lastFailureTime = Date.now();

  if (circuitBreakerState.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerState.state = "open";
  }
}

/**
 * Fetch with timeout
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeout
 * @return {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw err;
  }
}

/**
 * Build query string for feature IDs with validation
 * @param {string[]} featureIds
 * @return {string}
 */
function buildQuery(featureIds) {
  // Validate and sanitize feature IDs
  const validIds = featureIds
    .filter((id) => typeof id === "string" && id.length > 0)
    .map((id) => id.replace(/[^a-zA-Z0-9-_.]/g, "")) // Remove invalid chars
    .filter((id) => id.length > 0);

  if (validIds.length === 0) {
    throw new Error("No valid feature IDs provided");
  }

  return validIds.map((id) => `id:${id}`).join(" OR ");
}

/**
 * Validate API response structure
 * @param {any} data
 * @return {boolean}
 */
function isValidResponse(data) {
  return (
    data &&
    typeof data === "object" &&
    Array.isArray(data.data) &&
    data.data.every(
      (feature) =>
        feature &&
        typeof feature.feature_id === "string" &&
        (!feature.baseline ||
          (typeof feature.baseline === "object" &&
            ["limited", "newly", "widely"].includes(feature.baseline.status)))
    )
  );
}

/**
 * Fetch features from WebStatus API with circuit breaker and enhanced error handling
 * @param {string[]} featureIds
 * @param {number} retries
 * @return {Promise<WebStatusFeature[]>}
 */
async function fetchFeaturesBatch(featureIds, retries = 0) {
  // Check circuit breaker
  if (!shouldAllowRequest()) {
    throw new Error(
      "Circuit breaker is open - WebStatus API temporarily unavailable"
    );
  }

  if (featureIds.length === 0) {
    return [];
  }

  let query;
  try {
    query = buildQuery(featureIds);
  } catch (err) {
    throw new Error(`Invalid feature IDs: ${err.message}`);
  }

  const url = `${API_BASE}/features?q=${encodeURIComponent(query)}`;
  const requestStart = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Lighthouse/Baseline-Audit",
      },
    });

    const responseTime = Date.now() - requestStart;

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - use exponential backoff
        if (retries < MAX_RETRIES) {
          const backoffMs = Math.min(1000 * Math.pow(2, retries), 8000);
          await sleep(backoffMs);
          return fetchFeaturesBatch(featureIds, retries + 1);
        }
        recordFailure();
        throw new Error(`Rate limited after ${retries + 1} attempts`);
      }

      if (response.status >= 500) {
        // Server error - retry
        if (retries < MAX_RETRIES) {
          await sleep(1000 * Math.pow(2, retries));
          return fetchFeaturesBatch(featureIds, retries + 1);
        }
        recordFailure();
        throw new Error(`Server error: ${response.status}`);
      }

      // Client error - don't retry
      recordFailure();
      throw new Error(
        `Client error: ${response.status} ${response.statusText}`
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      recordFailure();
      throw new Error(`Invalid JSON response: ${parseErr.message}`);
    }

    if (!isValidResponse(data)) {
      recordFailure();
      throw new Error("Invalid response structure from WebStatus API");
    }

    recordSuccess();
    return data.data || [];
  } catch (err) {
    if (err.name === "AbortError" || err.message.includes("timeout")) {
      if (retries < MAX_RETRIES) {
        await sleep(500 * Math.pow(2, retries));
        return fetchFeaturesBatch(featureIds, retries + 1);
      }
      recordFailure();
      throw new Error(`Request timeout after ${retries + 1} attempts`);
    }

    if (
      err.message.includes("Circuit breaker") ||
      err.message.includes("Invalid feature IDs")
    ) {
      throw err; // Don't retry these
    }

    if (retries < MAX_RETRIES) {
      await sleep(500 * Math.pow(2, retries));
      return fetchFeaturesBatch(featureIds, retries + 1);
    }

    recordFailure();
    throw err;
  }
}

/**
 * Process batch of feature IDs with enhanced error handling
 * @param {string[]} featureIds
 * @return {Promise<Map<string, BaselineStatus>>}
 */
async function processBatch(featureIds) {
  const results = new Map();

  if (!featureIds || featureIds.length === 0) {
    return results;
  }

  try {
    const features = await fetchFeaturesBatch(featureIds);

    // Create a set for faster lookup
    const foundFeatureIds = new Set();

    // Process successful responses
    for (const feature of features) {
      if (!feature || !feature.feature_id) {
        continue; // Skip malformed features
      }

      foundFeatureIds.add(feature.feature_id);

      if (feature.baseline && feature.baseline.status) {
        const status = {
          status: feature.baseline.status,
          low_date: feature.baseline.low_date || undefined,
          high_date: feature.baseline.high_date || undefined,
        };

        results.set(feature.feature_id, status);
        cache.set(feature.feature_id, status);
      } else {
        // Feature exists but no baseline data
        const unknownStatus = { status: "unknown" };
        results.set(feature.feature_id, unknownStatus);
        cache.set(feature.feature_id, unknownStatus);
      }
    }

    // Mark missing features as unknown
    for (const id of featureIds) {
      if (!foundFeatureIds.has(id)) {
        const unknownStatus = { status: "unknown" };
        results.set(id, unknownStatus);
        cache.set(id, unknownStatus);
      }
    }
  } catch (err) {
    // Log error but continue gracefully
    console.warn(`WebStatus API batch failed: ${err.message}`);

    // On error, mark all as unknown
    for (const id of featureIds) {
      const unknownStatus = { status: "unknown" };
      results.set(id, unknownStatus);
      cache.set(id, unknownStatus);
    }
  }

  return results;
}

/**
 * Fetch Baseline status for multiple feature IDs
 * @param {Set<string>} featureIds
 * @return {Promise<Map<string, BaselineStatus>>}
 */
async function fetchBaselineStatus(featureIds) {
  const results = new Map();
  const toFetch = [];

  // Check cache first and track stats
  for (const id of featureIds) {
    if (cache.has(id)) {
      results.set(id, cache.get(id));
      cacheStats.hits++;
    } else {
      toFetch.push(id);
      cacheStats.misses++;
    }
  }

  if (toFetch.length === 0) {
    return results;
  }

  // Batch requests
  const batches = [];
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + BATCH_SIZE));
  }

  // Check if circuit breaker is open before starting
  if (!shouldAllowRequest()) {
    throw new Error(
      "WebStatus API temporarily unavailable - circuit breaker open"
    );
  }

  let hasAnyFailures = false;

  // Process batches in parallel (but not too many at once)
  const maxConcurrent = 3;
  for (let i = 0; i < batches.length; i += maxConcurrent) {
    const batchPromises = batches
      .slice(i, i + maxConcurrent)
      .map(async (batch) => {
        try {
          const result = await processBatch(batch);
          // Check if all results are unknown (indicating batch failure)
          const allUnknown = Array.from(result.values()).every(
            (status) => status.status === "unknown"
          );
          if (allUnknown && batch.length > 0) {
            hasAnyFailures = true;
          }
          return result;
        } catch (err) {
          hasAnyFailures = true;
          // Still process gracefully but track the failure
          const failureResults = new Map();
          for (const id of batch) {
            failureResults.set(id, { status: "unknown" });
          }
          return failureResults;
        }
      });

    const batchResults = await Promise.all(batchPromises);
    for (const batchMap of batchResults) {
      for (const [id, status] of batchMap) {
        results.set(id, status);
      }
    }
  }

  // If we had failures and circuit breaker state indicates problems, throw
  if (hasAnyFailures && circuitBreakerState.failureCount > 0) {
    throw new Error("WebStatus API unreachable - multiple request failures");
  }

  return results;
}

/**
 * Clear the cache (useful for testing)
 */
function clearCache() {
  cache.clear();
}

/**
 * Get cache and circuit breaker stats (useful for debugging)
 * @return {{cache: {size: number, hits: number, misses: number}, circuitBreaker: {state: string, failureCount: number}}}
 */
function getStats() {
  return {
    cache: {
      size: cache.size,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate:
        cacheStats.hits + cacheStats.misses > 0
          ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses)).toFixed(3)
          : "0.000",
    },
    circuitBreaker: {
      state: circuitBreakerState.state,
      failureCount: circuitBreakerState.failureCount,
      lastFailureTime: circuitBreakerState.lastFailureTime,
    },
  };
}

/**
 * Reset circuit breaker state (useful for testing)
 */
function resetCircuitBreaker() {
  circuitBreakerState = {
    failureCount: 0,
    lastFailureTime: 0,
    state: "closed",
  };
}

/**
 * Reset cache stats (useful for testing)
 */
function resetCacheStats() {
  cacheStats = {
    hits: 0,
    misses: 0,
  };
}

export {
  fetchBaselineStatus,
  clearCache,
  getStats,
  resetCircuitBreaker,
  resetCacheStats,
};
export default {
  fetchBaselineStatus,
  clearCache,
  getStats,
  resetCircuitBreaker,
  resetCacheStats,
};
