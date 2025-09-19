# Baseline

## Overview

The **Baseline** audit evaluates whether a web page uses Web Platform features that are safe to use across modern browsers. It leverages the [Web Platform Baseline](https://web.dev/baseline) project to determine feature availability and provides guidance on browser compatibility.

## What is Baseline?

Baseline tracks which Web Platform features have reliable cross-browser support:

- **Widely available**: Features supported in browsers used by 95%+ of global users for 30+ months
- **Newly available**: Features supported in the latest versions of all major browsers but not yet "widely available"
- **Limited availability**: Features with gaps in browser support

## How the Audit Works

The Baseline audit follows a four-step process:

### 1. Feature Detection

Extracts tokens from Lighthouse artifacts:

- **JavaScript**: API usage, constructors, and method calls from `Scripts` artifact
- **CSS**: Properties, at-rules, and selectors from `Stylesheets` and `CSSUsage` artifacts
- **HTML**: Modern elements and attributes from various DOM artifacts

### 2. Token Mapping

Maps detected tokens to canonical feature IDs using an auto-generated mapping from the [web-features](https://github.com/web-platform-dx/web-features) dataset.

### 3. Status Query

Queries the [WebStatus API](https://api.webstatus.dev) to determine each feature's Baseline status, with:

- Batched requests (up to 20 features per request)
- 5-second timeout with retries
- In-memory caching per audit run

### 4. Scoring

Calculates a 0-100 score using an enhanced algorithm that considers:

**Base Scoring:**

- Widely available: 3 points
- Newly available: 2 points (1.5 for core features)
- Limited availability: 0 points (-1 for core features)
- Unknown: 0 points

**Advanced Features:**

- **Progressive Enhancement Bonus**: Up to 15% bonus for using core features as foundation with appropriate enhancements
- **Usage Weighting**: Features weighted by actual usage frequency (0.3x to 2.0x)
- **Core Feature Detection**: Essential web platform features receive higher weights
- **Limited Feature Penalty**: 20% penalty if >30% of features have limited support

**Smart Prioritization:**

- Core features with limited support flagged as high priority
- Results sorted by impact and compatibility concerns

## Running the Audit

### Command Line

Run Lighthouse with only the Baseline category:

```bash
# Run on a specific URL
lighthouse https://example.com --only-categories=baseline

# Save results to JSON
lighthouse https://example.com --only-categories=baseline --output=json --output-path=baseline-report.json

# Include in full audit
lighthouse https://example.com
```

### Programmatic Usage

```javascript
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless"] });
const options = {
  logLevel: "info",
  output: "json",
  onlyCategories: ["baseline"],
  port: chrome.port,
};

const runnerResult = await lighthouse("https://example.com", options);
const baselineScore = runnerResult.lhr.categories.baseline.score * 100;
console.log(`Baseline score: ${baselineScore}%`);

await chrome.kill();
```

## Interpreting Results

### Score Breakdown

- **90-100**: Excellent - Mostly widely-available features
- **70-89**: Good - Mix of widely and newly available features
- **50-69**: Fair - Some limited availability features detected
- **0-49**: Poor - Many features with limited browser support

### Details Table

The audit provides a detailed breakdown showing:

| Column       | Description                                        |
| ------------ | -------------------------------------------------- |
| Feature      | The Web Platform feature ID                        |
| Baseline     | Current availability status (Widely/Newly/Limited) |
| Newly since  | Date when feature became newly available           |
| Widely since | Date when feature became widely available          |
| Where found  | File or context where feature was detected         |
| Weight       | Usage weight (if coverage data available)          |

### Common Feature Categories

**Layout & Styling:**

- CSS Grid (`grid`) - Widely available since 2020
- Flexbox (`flexbox`) - Widely available since 2017
- Container Queries (`container-queries`) - Newly available since 2022
- `:has()` selector (`has`) - Limited availability

**JavaScript APIs:**

- Fetch API (`fetch`) - Widely available since 2017
- Intersection Observer (`intersectionobserver`) - Widely available since 2019
- Array.at() (`array-at`) - Newly available since 2022
- Web Streams (`streams`) - Limited availability

**HTML Features:**

- `<dialog>` element (`dialog`) - Newly available since 2022
- Loading attribute (`loading-lazy`) - Widely available since 2019
- Popover API (`popover`) - Limited availability

## Regenerating Feature Mappings

The audit uses pre-generated mappings from web-features to canonical feature IDs. To update these mappings:

```bash
# Update to latest web-features dataset
yarn baseline-update-map

# Generate full mapping (not size-limited)
yarn baseline-update-map --full

# Manual update
node core/scripts/baseline/update-feature-map.mjs
```

This uses the official [web-features npm package](https://www.npmjs.com/package/web-features) to generate:

- `assets/baseline/feature-map.json` - Full token→feature mapping (6,700+ mappings)
- `assets/baseline/feature-map.seed.json` - Compact fallback for offline use

**Enhanced Mapping Features:**

- **BCD Key Support**: Accurate mapping using Browser Compatibility Data patterns
- **Vendor Prefix Handling**: Automatic detection of -webkit-, -moz-, etc.
- **Smart Token Extraction**: Improved CSS property shorthand resolution
- **Pattern Matching**: Fallback regex patterns for common feature families

## Implementation Details

### Graceful Degradation

The audit handles missing data gracefully:

- **Missing CSSUsage**: Falls back to stylesheet parsing, adds warning
- **Missing JsUsage**: Skips usage weighting, adds warning
- **API unavailable**: Uses cached/unknown status, adds warning
- **No artifacts**: Returns perfect score with empty details

### Performance Considerations

- **Batched API requests**: Up to 20 features per WebStatus API call
- **Response caching**: Avoids duplicate requests within a single run
- **Circuit Breaker Pattern**: Prevents cascade failures with automatic recovery
- **Enhanced Error Handling**: Validates responses and sanitizes inputs
- **Smart Retry Logic**: Exponential backoff with jitter for rate limiting
- **Concurrent Processing**: Parallel batch processing with concurrency limits
- **Artifact processing**: Optimized token extraction with early termination

### Coverage Integration

When JavaScript/CSS usage data is available, the audit applies usage weighting:

- **High usage** (100+ references): 1.5x weight
- **Medium usage** (10-99 references): 1.2x weight
- **Low usage** (1-9 references): 0.8x weight
- **No usage data**: 1.0x weight

## Troubleshooting

### Common Issues

**"No features detected"**

- Check that the page uses modern Web Platform features
- Verify artifacts are being collected correctly
- Try running with `--gather-mode=navigation`

**"WebStatus API unreachable"**

- Check internet connectivity
- API may be temporarily unavailable
- Cached/fallback data will be used

**"Analysis may be incomplete"**

- CSS/JS usage artifacts missing
- Run with default gathering to collect all artifacts
- Consider using `--preset=desktop` for fuller coverage

### Debug Information

Enable debug logging for detailed information:

```bash
DEBUG=lh:audit:baseline-readiness lighthouse https://example.com --only-categories=baseline
```

## Best Practices

### Progressive Enhancement Strategy

**✅ Recommended Approach:**

1. **Solid Foundation**: Use widely-available core features (fetch, CSS Grid, Flexbox)
2. **Feature Detection**: Test for newer APIs before using them
3. **Graceful Fallbacks**: Provide alternatives for limited-support features
4. **Strategic Enhancement**: Add newly-available features that improve UX

**Example:**

```javascript
// Core foundation
fetch("/api/data").then((response) => response.json());

// Progressive enhancement with detection
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(callback);
} else {
  // Fallback: use scroll events or load all content
}

// Conditional modern features
if (Array.prototype.at) {
  const last = items.at(-1);
} else {
  const last = items[items.length - 1];
}
```

### Baseline Score Optimization

- **90-100%**: Excellent - Focus on widely-available features
- **70-89%**: Good - Mix is appropriate, consider alternatives for limited features
- **50-69%**: Needs improvement - Too many bleeding-edge features
- **0-49%**: Poor - Reconsider architecture for better compatibility

### Development Workflow

1. **Run Baseline Early**: Check compatibility during development
2. **Monitor Feature Status**: Features move from limited → newly → widely over time
3. **Update Mappings**: Refresh feature data periodically with `yarn baseline-update-map`
4. **Review Warnings**: Pay attention to core feature compatibility issues

## Related Resources

- [Web Platform Baseline](https://web.dev/baseline) - Official Baseline documentation
- [WebStatus API](https://api.webstatus.dev) - Browser compatibility data source
- [web-features](https://github.com/web-platform-dx/web-features) - Feature definitions

## FAQ

**Q: Why do some widely-used features show as "Limited"?**
A: Baseline status reflects cross-browser support, not usage. A feature might be popular but still have gaps in browser support.

**Q: How often is the WebStatus data updated?**
A: WebStatus data updates regularly. Run `yarn baseline-update-map` to refresh local mappings.

**Q: Can I use this audit for older browser support requirements?**
A: Baseline focuses on modern browser support (95%+ of users). For broader compatibility, consider additional tools and testing.

**Q: Does the audit detect polyfilled features?**
A: The audit detects feature usage in source code. Polyfills may affect actual browser support but won't change the audit results.
