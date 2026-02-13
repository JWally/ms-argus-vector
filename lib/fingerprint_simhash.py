"""
SimHash Implementation for Fingerprint Similarity

Option 2: Locality-Sensitive Hashing approach using SimHash.
Produces a fixed 64-bit hash where similar inputs produce similar outputs.

SimHash works by:
1. Converting each feature to a weighted hash
2. Accumulating bit positions based on feature hashes
3. Final hash bits are set based on accumulated weights

Properties:
- Hamming distance between SimHashes correlates with similarity
- More similar fingerprints have fewer differing bits
- Can use QDrant's binary vector support for fast search

Usage:
    from fingerprint_simhash import compute_simhash, hamming_distance, similarity_score

    hash1 = compute_simhash(fingerprint1)
    hash2 = compute_simhash(fingerprint2)

    distance = hamming_distance(hash1, hash2)  # 0-64 bits different
    score = similarity_score(hash1, hash2)      # 0.0-1.0 similarity
"""

import hashlib
from typing import Any, Dict, List, Tuple, Optional


# Number of bits in SimHash
SIMHASH_BITS = 64


# Feature weights - higher weight = more influence on final hash
FEATURE_WEIGHTS = {
    # Highest importance - very stable, highly identifying
    'canvas.dataURI': 6,
    'canvas.textURI': 5,
    'canvas.emojiURI': 4,
    'audio.compressorGainReduction': 5,
    'webgl.renderer': 5,

    # High importance - stable hardware/software identifiers
    'platform': 4,
    'system': 4,
    'gpu.vendor': 4,
    'engine': 4,
    'hardwareConcurrency': 3,
    'deviceMemory': 3,

    # Medium importance - stable but common values
    'screen.resolution': 3,
    'colorDepth': 2,
    'timezone.offset': 2,
    'fonts.count': 2,
    'webgl.extensions.count': 2,

    # Lower importance - less stable or less unique
    'maxTouchPoints': 1,
    'language': 1,
    'headless.rating': 1,
}


def safe_get(data: Dict, *keys, default=None) -> Any:
    """Safely navigate nested dict."""
    current = data
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return default
    return current if current is not None else default


def get_array_len(arr) -> int:
    """
    Get length of array, handling compacted format.
    Compacted arrays are: {"$simhash": "...", "$len": N}
    """
    if isinstance(arr, list):
        return len(arr)
    if isinstance(arr, dict) and '$len' in arr:
        return arr['$len']
    return 0


def hash_to_bits(value: str) -> List[int]:
    """
    Convert a string value to a list of 64 bits using SHA-256.
    Returns list of 1s and -1s (for weighted accumulation).
    """
    h = hashlib.sha256(value.encode()).digest()
    bits = []
    for i in range(SIMHASH_BITS):
        byte_idx = i // 8
        bit_idx = i % 8
        bit = (h[byte_idx] >> bit_idx) & 1
        bits.append(1 if bit else -1)
    return bits


def bucketize(value: float, buckets: List[float]) -> str:
    """
    Convert numeric value to bucket string for hashing.
    Returns bucket identifier like 'bucket_2' for the appropriate range.
    """
    for i, threshold in enumerate(buckets):
        if value < threshold:
            return f"bucket_{i}"
    return f"bucket_{len(buckets)}"


def extract_vendor(gpu_string: str) -> str:
    """Extract GPU vendor from renderer string."""
    gpu_lower = (gpu_string or '').lower()
    if 'nvidia' in gpu_lower or 'geforce' in gpu_lower:
        return 'nvidia'
    elif 'amd' in gpu_lower or 'radeon' in gpu_lower:
        return 'amd'
    elif 'intel' in gpu_lower:
        return 'intel'
    elif 'apple' in gpu_lower:
        return 'apple'
    elif 'qualcomm' in gpu_lower or 'adreno' in gpu_lower:
        return 'qualcomm'
    elif 'arm' in gpu_lower or 'mali' in gpu_lower:
        return 'arm'
    elif 'swiftshader' in gpu_lower:
        return 'swiftshader'
    return 'unknown'


def extract_features(payload: Dict) -> Dict[str, str]:
    """
    Extract features from fingerprint payload.
    All values are converted to strings for hashing.
    """
    features = {}

    # Handle both old and new payload formats
    # Old format: payload.fingerprint.loose / payload.fingerprint.stable
    # New format: payload.device (flat structure)
    fp = payload.get('fingerprint', payload)
    stable = fp.get('stable', {})
    loose = fp.get('loose', {})
    device = payload.get('device', {})

    # Use device (new format) or fall back to stable/loose (old format)
    def get_section(name):
        return device.get(name) or stable.get(name) or loose.get(name) or {}

    navigator = get_section('navigator')
    worker = get_section('workerScope')
    screen = get_section('screen')
    audio = get_section('offlineAudioContext')
    canvas = get_section('canvas2d')
    webgl = get_section('canvasWebgl')
    timezone = get_section('timezone')
    headless = get_section('headless')
    resistance = get_section('resistance')

    # Canvas hashes - use directly (already hashes)
    if canvas.get('dataURI'):
        features['canvas.dataURI'] = str(canvas['dataURI'])
    if canvas.get('textURI'):
        features['canvas.textURI'] = str(canvas['textURI'])
    if canvas.get('emojiURI'):
        features['canvas.emojiURI'] = str(canvas['emojiURI'])

    # Audio - bucket the compressor gain (key engine identifier)
    comp_gain = safe_get(audio, 'compressorGainReduction', default=-25)
    features['audio.compressorGainReduction'] = bucketize(
        comp_gain, [-35, -32, -29, -25, -20, -15, 0]
    )

    # Platform identifiers
    features['platform'] = str(safe_get(navigator, 'platform', default='unknown'))
    features['system'] = str(safe_get(navigator, 'system', default='unknown'))

    # Browser engine
    engine = safe_get(resistance, 'engine', default='')
    worker_engine = safe_get(worker, 'userAgentEngine', default='')
    features['engine'] = f"{engine}_{worker_engine}".strip('_') or 'unknown'

    # GPU
    params = safe_get(webgl, 'parameters', default={})
    renderer = safe_get(params, 'UNMASKED_RENDERER_WEBGL', default='')
    if not renderer:
        renderer = safe_get(worker, 'webglRenderer', default='')
    features['webgl.renderer'] = renderer[:100] if renderer else 'unknown'
    features['gpu.vendor'] = extract_vendor(renderer)

    # Hardware
    features['hardwareConcurrency'] = bucketize(
        safe_get(navigator, 'hardwareConcurrency', default=4),
        [2, 4, 6, 8, 12, 16, 24, 32, 64]
    )
    features['deviceMemory'] = bucketize(
        safe_get(navigator, 'deviceMemory', default=4),
        [0.5, 1, 2, 4, 8, 16, 32]
    )

    # Screen
    width = safe_get(screen, 'width', default=1920)
    height = safe_get(screen, 'height', default=1080)
    features['screen.resolution'] = f"{bucketize(width, [1024, 1280, 1920, 2560, 3840])}x{bucketize(height, [720, 900, 1080, 1440, 2160])}"

    color_depth = safe_get(screen, 'colorDepth', default=24)
    features['colorDepth'] = str(color_depth)

    # Timezone
    features['timezone.offset'] = bucketize(
        safe_get(timezone, 'offset', default=0),
        [-720, -480, -360, -300, -240, 0, 60, 120, 330, 480, 540, 720]
    )

    # Touch capability
    features['maxTouchPoints'] = bucketize(
        safe_get(navigator, 'maxTouchPoints', default=0),
        [1, 2, 5, 10]
    )

    # Language
    features['language'] = str(safe_get(navigator, 'language', default='unknown'))[:10]

    # Font and extension counts - handle compacted arrays
    fonts_obj = device.get('fonts') or stable.get('fonts') or loose.get('fonts') or {}
    fonts_arr = fonts_obj.get('fontFaceLoadFonts', []) if isinstance(fonts_obj, dict) else fonts_obj
    font_count = get_array_len(fonts_arr)
    features['fonts.count'] = bucketize(font_count, [5, 10, 20, 40, 60, 80]) if font_count > 0 else 'unknown'

    extensions = safe_get(webgl, 'extensions', default=[])
    ext_count = get_array_len(extensions)
    features['webgl.extensions.count'] = bucketize(ext_count, [10, 20, 30, 40, 50]) if ext_count > 0 else 'unknown'

    # Headless detection score
    headless_rating = safe_get(headless, 'likeHeadlessRating', default=0)
    features['headless.rating'] = bucketize(headless_rating, [5, 15, 30, 50, 75])

    return features


def compute_simhash(payload: Dict) -> int:
    """
    Compute SimHash for a fingerprint payload.

    Returns a 64-bit integer where similar fingerprints
    will have similar bit patterns.
    """
    features = extract_features(payload)

    # Accumulator for weighted bit positions
    V = [0] * SIMHASH_BITS

    for feature_name, feature_value in features.items():
        # Get weight for this feature
        weight = FEATURE_WEIGHTS.get(feature_name, 1)

        # Compute hash for "feature:value" string
        feature_str = f"{feature_name}:{feature_value}"
        bits = hash_to_bits(feature_str)

        # Accumulate weighted bits
        for i, bit in enumerate(bits):
            V[i] += bit * weight

    # Convert accumulator to final hash
    simhash = 0
    for i in range(SIMHASH_BITS):
        if V[i] > 0:
            simhash |= (1 << i)

    return simhash


def simhash_to_hex(simhash: int) -> str:
    """Convert SimHash to 16-character hex string."""
    return f"{simhash:016x}"


def hex_to_simhash(hex_str: str) -> int:
    """Convert hex string back to SimHash integer."""
    return int(hex_str, 16)


def simhash_to_binary_vector(simhash: int) -> List[float]:
    """
    Convert SimHash to binary vector for QDrant.
    Returns list of 64 floats (0.0 or 1.0).
    """
    return [float((simhash >> i) & 1) for i in range(SIMHASH_BITS)]


def hamming_distance(hash1: int, hash2: int) -> int:
    """
    Compute Hamming distance between two SimHashes.
    Returns number of differing bits (0-64).
    """
    xor = hash1 ^ hash2
    return bin(xor).count('1')


def similarity_score(hash1: int, hash2: int) -> float:
    """
    Compute similarity score between two SimHashes.
    Returns 0.0 (completely different) to 1.0 (identical).
    """
    distance = hamming_distance(hash1, hash2)
    return 1.0 - (distance / SIMHASH_BITS)


def analyze_simhash_difference(payload1: Dict, payload2: Dict) -> Dict[str, Any]:
    """
    Analyze why two fingerprints produce different SimHashes.
    Useful for debugging and understanding matches.
    """
    features1 = extract_features(payload1)
    features2 = extract_features(payload2)

    differences = []
    for key in set(features1.keys()) | set(features2.keys()):
        val1 = features1.get(key, '<missing>')
        val2 = features2.get(key, '<missing>')
        if val1 != val2:
            weight = FEATURE_WEIGHTS.get(key, 1)
            differences.append({
                'feature': key,
                'value1': val1,
                'value2': val2,
                'weight': weight,
            })

    # Sort by weight (most important differences first)
    differences.sort(key=lambda x: -x['weight'])

    hash1 = compute_simhash(payload1)
    hash2 = compute_simhash(payload2)

    return {
        'hash1': simhash_to_hex(hash1),
        'hash2': simhash_to_hex(hash2),
        'hamming_distance': hamming_distance(hash1, hash2),
        'similarity_score': similarity_score(hash1, hash2),
        'feature_differences': differences,
        'total_features': len(features1),
    }


if __name__ == '__main__':
    import json
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            payload = json.load(f)

        simhash = compute_simhash(payload)
        features = extract_features(payload)

        print(f"SimHash: {simhash_to_hex(simhash)}")
        print(f"Binary:  {bin(simhash)}")
        print(f"\nExtracted features ({len(features)}):")
        for k, v in sorted(features.items()):
            weight = FEATURE_WEIGHTS.get(k, 1)
            print(f"  [{weight}] {k}: {v}")

        # If two files provided, compare them
        if len(sys.argv) > 2:
            with open(sys.argv[2]) as f:
                payload2 = json.load(f)

            analysis = analyze_simhash_difference(payload, payload2)
            print(f"\n=== Comparison ===")
            print(f"Hash 1: {analysis['hash1']}")
            print(f"Hash 2: {analysis['hash2']}")
            print(f"Hamming distance: {analysis['hamming_distance']} bits")
            print(f"Similarity score: {analysis['similarity_score']:.2%}")
            print(f"\nFeature differences ({len(analysis['feature_differences'])}):")
            for diff in analysis['feature_differences']:
                print(f"  [{diff['weight']}] {diff['feature']}")
                print(f"       1: {diff['value1']}")
                print(f"       2: {diff['value2']}")
