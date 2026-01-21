# Fingerprint Metrics Analysis for QDrant Vector Search

## Overview

Analyzing ms-argus-web fingerprint metrics to design a vector representation suitable for QDrant similarity search.

## Current Fuzzy Hash (NOT suitable for similarity search)

The current fuzzy hash in `crypto.ts`:
1. Takes 155 metric keys
2. Bins them into 64 groups (~5 metrics per bin)
3. SHA-256 hashes each bin
4. Takes only the FIRST CHARACTER of each hash
5. Concatenates to form a 64-char hex string

**Problem**: SHA-256 is cryptographic - small input changes produce completely different outputs. This destroys any similarity relationship.

---

## Data Structure Analysis (from real payloads)

### Top-level structure
```
{
  "evercookie": { id, created, lastSeen },
  "cryptoId": { publicKey, date },
  "fingerprint": {
    "hashes": { loose, stable, fuzzy, deviceOfTimezone },
    "stable": { ... device-identifying metrics ... },
    "loose": { ... all metrics including volatile ... },
    "botSignals": { ... },
    "inconsistencies": { ... }
  }
}
```

### Fingerprint Categories

**stable** - Metrics that should NOT change for same device:
- navigator, workerScope, media, canvas2d, canvasWebgl
- cssMedia, css, timezone, offlineAudioContext, fonts, wasm

**loose** - All metrics including session-variable ones:
- Everything in stable PLUS: features, headless, intl, lies
- screen, svg, voices, windowFeatures, etc.

---

## Metric Types Classification

### 1. NUMERIC - Directly usable as vector dimensions

**Screen (6 dimensions)**
- width, height, availWidth, availHeight: integers (e.g., 2560, 1440)
- colorDepth, pixelDepth: integers (typically 24)

**Audio (5 key dimensions)**
- compressorGainReduction: float (e.g., -31.5) - ENGINE IDENTIFIER
- floatFrequencyDataSum: float (e.g., 167699.85)
- floatTimeDomainDataSum: float (e.g., 148.48)
- sampleSum: float (e.g., 35.75)
- totalUniqueSamples: int (e.g., 4736)

**Hardware (3 dimensions)**
- hardwareConcurrency: int (e.g., 12)
- deviceMemory: float (e.g., 8)
- maxTouchPoints: int (e.g., 0)

**Timezone (2 dimensions)**
- offset: int minutes from UTC (e.g., 360 = UTC-6)
- offsetComputed: int (should match offset)

**Canvas/SVG (5 dimensions)**
- textMetricsSystemSum: float (e.g., 0.043)
- svgrectSystemSum: float (e.g., 0.055)
- svg.bBox: float (e.g., 113112.66)
- svg.extentOfChar: float (e.g., 381.7)
- svg.computedTextLength: float (e.g., 274.7)

**WebGL Parameters (20+ dimensions)**
- MAX_TEXTURE_SIZE: int (e.g., 16384)
- MAX_VIEWPORT_DIMS: [int, int] (e.g., [32767, 32767])
- MAX_VERTEX_ATTRIBS: int (e.g., 16)
- ... many more GPU capability values

**Headless Detection (3 dimensions)**
- likeHeadlessRating: int 0-100
- headlessRating: int 0-100
- stealthRating: int 0-100

**Audio Samples (100 dimensions)**
- binsSample: array of 100 floats (-0.12 to 0.12 range)
- These are HIGHLY device-specific audio fingerprints

### 2. BOOLEAN - Encode as 0/1

**Headless signals (~24 booleans)**
- likeHeadless: noChrome, hasPermissionsBug, noPlugins, noMimeTypes, etc.
- headless: webDriverIsOn, hasHeadlessUA, hasHeadlessWorkerUA
- stealth: hasIframeProxy, hasHighChromeIndex, hasBadChromeRuntime, etc.

**Other booleans**
- screen.touch
- navigator.uaPostReduction
- wasm.simdSupported
- Various .lied flags

### 3. CATEGORICAL - Need encoding (one-hot or embedding)

**Platform/OS (high importance)**
- platform: "Win32", "MacIntel", "Linux x86_64"
- system: "Windows", "Mac OS", "Linux"
- device: "Windows 10 (64-bit)", "iPhone", etc.

**Browser Engine**
- userAgentEngine: "SpiderMonkey", "V8", "JavaScriptCore"
- resistance.engine: "Blink", "Gecko"

**GPU (medium importance)**
- webglRenderer: "NVIDIA GeForce GTX 980..."
- webglVendor: "Google Inc. (NVIDIA)"
- gpu.compressedGPU: "NVIDIA, NVIDIA GeForce GTX 900s"

**Locale (low importance for device matching)**
- timezone.location: "America/Chicago"
- intl.locale: "en-US"
- language: "en-US"

### 4. HASH STRINGS - Use for exact matching only

- canvas2d.dataURI: "7cea9092" (8-char hash)
- canvas2d.paintURI: "45ce59fa"
- canvasWebgl.dataURI: "..."
- All $hash fields

### 5. ARRAYS - Need special handling

**Font list (variable length)**
- fonts: ["Bahnschrift", "Cambria Math", ...]
- Could use: count, hash, or set membership vector

**WebGL extensions (variable length)**
- extensions: ["ANGLE_instanced_arrays", "EXT_blend_minmax", ...]
- Could use: bitmap of known extensions

**Emoji sets**
- emojiSet: array of supported emojis
- Could use: count or bitmap

---

## Option 1: Raw Vector Design

### Proposed Vector Structure (~200 dimensions)

```
SECTION 1: Core Hardware (10 dims)
├─ screen: width, height, availWidth, availHeight, colorDepth, pixelDepth
├─ hardware: hardwareConcurrency, deviceMemory, maxTouchPoints
└─ touch: (boolean as 0/1)

SECTION 2: Audio Fingerprint (108 dims)
├─ summary: compressorGainReduction, floatFrequencyDataSum,
│           floatTimeDomainDataSum, sampleSum, totalUniqueSamples, noise
└─ samples: binsSample[0:99] (100 floats)

SECTION 3: Canvas/SVG Metrics (5 dims)
├─ textMetricsSystemSum, svgrectSystemSum
└─ svg.bBox, svg.extentOfChar, svg.computedTextLength

SECTION 4: WebGL Capabilities (25 dims)
├─ MAX_TEXTURE_SIZE, MAX_CUBE_MAP_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE
├─ MAX_VIEWPORT_DIMS[0], MAX_VIEWPORT_DIMS[1]
├─ MAX_VERTEX_ATTRIBS, MAX_VERTEX_UNIFORM_VECTORS, MAX_VARYING_VECTORS
├─ MAX_COMBINED_TEXTURE_IMAGE_UNITS, MAX_VERTEX_TEXTURE_IMAGE_UNITS
├─ MAX_TEXTURE_IMAGE_UNITS, MAX_FRAGMENT_UNIFORM_VECTORS
├─ MAX_3D_TEXTURE_SIZE, MAX_ELEMENTS_VERTICES, MAX_ELEMENTS_INDICES
├─ MAX_DRAW_BUFFERS, MAX_SAMPLES, MAX_VERTEX_UNIFORM_BLOCKS
├─ MAX_FRAGMENT_UNIFORM_BLOCKS, MAX_COMBINED_UNIFORM_BLOCKS
└─ ... (select most discriminating)

SECTION 5: Timezone (2 dims)
└─ offset, offsetComputed

SECTION 6: Headless Detection (19 dims)
├─ ratings: likeHeadlessRating, headlessRating, stealthRating
├─ likeHeadless booleans (16): noChrome, hasPermissionsBug, ...
└─ (headless and stealth booleans can be added)

SECTION 7: Platform Encoding (15 dims one-hot)
├─ OS: Windows, Mac, Linux, iOS, Android, Other (6)
├─ Engine: Blink, Gecko, WebKit, Other (4)
└─ Form factor: Desktop, Mobile, Tablet, Other (4)

SECTION 8: GPU Encoding (16 dims one-hot)
└─ Major GPU vendors/families: NVIDIA, AMD, Intel, Apple, Mali, Adreno, etc.

TOTAL: ~200 dimensions
```

### Normalization Requirements

**Min-max scaling for bounded values:**
- Screen dimensions: 0-8192 range
- Hardware concurrency: 1-128 range
- Color depth: 8-32 range

**Standard scaling for audio:**
- compressorGainReduction: typically -40 to 0
- Frequency sums: varies widely, use log scale

**Binary encoding:**
- All booleans: 0 or 1

---

## Option 2: SimHash Design

### What is SimHash?

SimHash is a locality-sensitive hashing algorithm where:
- Similar inputs produce similar outputs
- Hamming distance between hashes correlates with similarity
- Works by: weighted bit-flipping based on feature hashes

### SimHash Algorithm

```
function simhash(features, weights):
    V = [0] * 64  // 64-bit accumulator

    for each (feature, value) in features:
        hash = sha256(feature + ":" + value)
        weight = weights[feature] or 1

        for i in 0..63:
            if hash[i] == 1:
                V[i] += weight
            else:
                V[i] -= weight

    // Convert to binary
    fingerprint = 0
    for i in 0..63:
        if V[i] > 0:
            fingerprint |= (1 << i)

    return fingerprint
```

### SimHash for Fingerprints

**Feature extraction:**
```javascript
function extractFeatures(fp) {
  const features = {};

  // Numeric features - bucket into ranges
  features['screen.width'] = bucketize(fp.screen.width, [0, 1024, 1920, 2560, 3840, 7680]);
  features['screen.height'] = bucketize(fp.screen.height, [0, 768, 1080, 1440, 2160, 4320]);
  features['hardware.concurrency'] = bucketize(fp.hardwareConcurrency, [1, 2, 4, 8, 16, 32, 64]);

  // Categorical features - use directly
  features['platform'] = fp.platform;
  features['engine'] = fp.resistance.engine;
  features['gpu.vendor'] = extractVendor(fp.webglVendor);

  // Audio features - bucket the key identifiers
  features['audio.compressor'] = bucketize(fp.audio.compressorGainReduction, [-35, -32, -28, -20, 0]);

  // Hash features - use as-is
  features['canvas.dataURI'] = fp.canvas2d.dataURI;
  features['canvas.textURI'] = fp.canvas2d.textURI;

  return features;
}
```

**Weights by importance:**
```javascript
const weights = {
  // High weight - very stable, device-identifying
  'canvas.dataURI': 5,
  'canvas.textURI': 5,
  'audio.compressor': 4,
  'platform': 4,
  'gpu.vendor': 4,

  // Medium weight - stable but less unique
  'screen.width': 2,
  'screen.height': 2,
  'hardware.concurrency': 2,

  // Low weight - can vary
  'timezone.offset': 1,
  'language': 1,
};
```

### SimHash Advantages
1. Fixed 64-bit output (compact)
2. Hamming distance = similarity
3. Can use QDrant's binary vectors
4. Fast comparison

### SimHash Disadvantages
1. Less precision than raw vectors
2. Need to choose features carefully
3. Hash collisions possible
4. Can't easily explain "why" two are similar

---

## Recommendation

### For your use case (find closest match, get similarity score):

**Use Option 1 (Raw Vectors)** because:
1. You need to know "how close" the match truly is
2. You want to understand which features matched
3. ~200 dimensions is reasonable for QDrant
4. Cosine similarity gives meaningful 0-1 score

**Consider hybrid approach:**
1. Use SimHash for fast initial filtering (if you have millions)
2. Use raw vectors for final ranking and scoring

### Implementation Priority

1. Start with a minimal vector (50-80 dims) using most stable metrics
2. Use audio fingerprint (100 dims) - highly unique
3. Add canvas hash encoding if needed
4. Expand to full 200 dims based on matching accuracy

---

## Implementation Status

Both approaches have been implemented and tested:

### Test Results

**Option 1 - Raw Vector** (`lib/fingerprint_vector.py`):
```
Vector dimension: 180
Vector stats: min=0.0000, max=1.0000, mean=0.2852
```

**Option 2 - SimHash** (`lib/fingerprint_simhash.py`):
```
SimHash: 085763709f2fc62d (64-bit)
Extracted features: 19 weighted features
```

**Cross-device comparison (Windows/NVIDIA vs Mac/Apple M1):**
```
Hamming distance: 23 bits
Similarity score: 64.06%

Key differences detected:
- canvas.dataURI (different rendering)
- platform (Win32 vs MacIntel)
- gpu.vendor (nvidia vs apple)
- screen.resolution (2560x1440 vs 1440x900)
- colorDepth (24 vs 30)
```

---

## Files Created

1. **`lib/fingerprint_vector.py`** - Option 1 implementation
   - 180-dimensional dense vector
   - Normalized to 0-1 range
   - Includes: screen, hardware, audio samples, WebGL params, headless signals, platform encoding

2. **`lib/fingerprint_simhash.py`** - Option 2 implementation
   - 64-bit locality-sensitive hash
   - Weighted features (canvas=6, audio=5, platform=4, etc.)
   - Includes feature comparison and debugging tools

---

## Next Steps

1. [x] Define exact vector schema
2. [x] Write vector extraction function
3. [x] Test with sample payloads
4. [ ] Deploy to QDrant
5. [ ] Benchmark similarity search accuracy
6. [ ] Tune feature weights based on real matching data
