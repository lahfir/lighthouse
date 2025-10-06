# Baseline Audit Recipe

The enhanced Baseline audit analyzes your web application's use of Web Platform features and evaluates their browser compatibility status according to [Baseline](https://web.dev/baseline).

## Quick Start

```bash
# Install dependencies and build
yarn install
yarn reset-link
yarn baseline-update-map
yarn build-report

# Run Baseline audit
lighthouse https://example.com --only-categories=baseline
```

## Configuration

### Budgets (CI Gating)

Create `baseline.budgets.json` to fail CI when scores drop or limited features appear:

```json
{
  "minScore": 0.9,
  "forbidLimited": true,
  "allowUnknown": false,
  "perRoute": {
    "/": { "minScore": 0.92 },
    "/checkout": { "forbidLimited": true }
  }
}
```

Use with Lighthouse CI:

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "baseline-readiness": ["error", { "minScore": 0.9 }]
      }
    }
  }
}
```

### UA Distribution Targets

Create `baseline.targets.json` to weight features by your actual browser usage:

```json
{
  "uaDistribution": {
    "safari": 0.35,
    "chrome": 0.4,
    "firefox": 0.15,
    "edge": 0.1
  }
}
```

## Diff Detection

Compare two reports to find regressions:

```bash
# Generate reports
lighthouse https://example.com --output=json --output-path=base.json
# ... make changes ...
lighthouse https://example.com --output=json --output-path=head.json

# Compare
node build/plugins/baseline-diff.mjs base.json head.json
```

Output shows:

- Score delta
- New limited features introduced
- Feature downgrades (widely→newly, newly→limited)
- Top 5 contributors to score change

## Export Formats

Export results for analysis or CI integration:

```bash
# Export as CSV
node build/plugins/baseline-export.mjs report.json --format=csv --out=baseline.csv

# Export as JSON
node build/plugins/baseline-export.mjs report.json --format=json --out=baseline.json

# Export as SARIF (for GitHub Code Scanning)
node build/plugins/baseline-export.mjs report.json --format=sarif --out=baseline.sarif
```

## How It Works

1. **Detect**: Extract Web Platform features from JavaScript, CSS, and HTML
2. **Map**: Convert tokens to canonical feature IDs via web-features package
3. **Query**: Fetch Baseline status from WebStatus API
4. **Weight**: Apply usage weights and UA distribution factors
5. **Score**: Calculate 0-100% compatibility score
6. **Budget**: Check against thresholds and fail if violated
7. **Export**: Output in multiple formats for integration

## Features

### Smart Detection

- **Concrete tokens only**: No generic "animations" category
- **Per-bundle attribution**: Shows which file uses each feature
- **Route tracking**: Features grouped by URL path
- **Vendor detection**: Distinguishes first-party vs third-party code

### Defensible Scoring

- **Usage-based weighting**: High-use features weighted more (0.5-1.5x)
- **UA-aware factors**: Adjust for your actual browser mix
- **Deterministic sorting**: Limited→Newly→Widely, then by weight
- **Clamped ranges**: Prevents extreme outliers

### Zero "Unknown"

- Only concrete, mappable tokens extracted
- Unresolved tokens excluded from scoring
- Debug info shows first 10 unmapped tokens

## API Usage

### Programmatic Access

```javascript
import {
  loadBudgets,
  evaluateBudgets,
} from "./core/computed/baseline/budgets.js";
import { loadTargets } from "./core/computed/baseline/targets.js";

// Load configuration
const policy = loadBudgets({ settings, mainDocumentUrl });
const targets = loadTargets({ settings });

// Evaluate budgets
const evaluation = evaluateBudgets({
  policy,
  route: "/checkout",
  score01: 0.85,
  rows: auditResults,
});

if (evaluation.violated) {
  console.error("Budget violation:", evaluation.reasons);
  process.exit(1);
}
```

## Notes

- Runs without CSS/JS usage artifacts (weights default to 1.0)
- API unavailability handled gracefully with cached/unknown status
- No external dependencies added
- All clamps deterministic and documented
