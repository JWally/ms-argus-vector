"""
Fingerprint Vector Extraction for QDrant

Option 1: Raw Vector approach - extracts numeric features directly as vector dimensions.
This provides the best similarity scoring and explainability.

Usage:
    from fingerprint_vector import extract_vector, VECTOR_DIM

    vector = extract_vector(fingerprint_payload)
    # vector is a list of floats with length VECTOR_DIM
"""

import math
from typing import Any, Dict, List, Optional

# Vector dimension - adjust based on features used
VECTOR_DIM = 180

# Normalization ranges
SCREEN_MAX = 8192
HARDWARE_CONCURRENCY_MAX = 128
COLOR_DEPTH_MAX = 32
MEMORY_MAX = 64  # GB
TIMEZONE_OFFSET_MAX = 720  # +/- 12 hours in minutes


def safe_get(data: Dict, *keys, default=0.0) -> Any:
    """Safely navigate nested dict."""
    current = data
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return default
    return current if current is not None else default


def normalize(value: float, min_val: float, max_val: float) -> float:
    """Normalize value to 0-1 range."""
    if max_val == min_val:
        return 0.0
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def log_normalize(value: float, max_val: float = 1e6) -> float:
    """Log-scale normalization for large values."""
    if value <= 0:
        return 0.0
    return min(1.0, math.log1p(value) / math.log1p(max_val))


def bool_to_float(value: Any) -> float:
    """Convert boolean to 0.0 or 1.0."""
    return 1.0 if value else 0.0


def one_hot_platform(platform: str, system: str) -> List[float]:
    """
    One-hot encode platform/OS.
    Returns 6 dimensions: [Windows, Mac, Linux, iOS, Android, Other]
    """
    platform_str = f"{platform} {system}".lower()

    result = [0.0] * 6
    if 'win' in platform_str:
        result[0] = 1.0
    elif 'mac' in platform_str or 'ipad' in platform_str:
        result[1] = 1.0
    elif 'linux' in platform_str and 'android' not in platform_str:
        result[2] = 1.0
    elif 'iphone' in platform_str or 'ios' in platform_str:
        result[3] = 1.0
    elif 'android' in platform_str:
        result[4] = 1.0
    else:
        result[5] = 1.0

    return result


def one_hot_engine(engine: str, user_agent: str = "") -> List[float]:
    """
    One-hot encode browser engine.
    Returns 4 dimensions: [Blink/V8, Gecko/SpiderMonkey, WebKit/JSC, Other]
    """
    engine_str = f"{engine} {user_agent}".lower()

    result = [0.0] * 4
    if 'blink' in engine_str or 'v8' in engine_str or 'chrome' in engine_str:
        result[0] = 1.0
    elif 'gecko' in engine_str or 'spidermonkey' in engine_str or 'firefox' in engine_str:
        result[1] = 1.0
    elif 'webkit' in engine_str or 'javascriptcore' in engine_str or 'safari' in engine_str:
        result[2] = 1.0
    else:
        result[3] = 1.0

    return result


def one_hot_gpu_vendor(gpu_info: str) -> List[float]:
    """
    One-hot encode GPU vendor.
    Returns 8 dimensions: [NVIDIA, AMD, Intel, Apple, Qualcomm/Adreno, ARM/Mali, Software, Other]
    """
    gpu_str = gpu_info.lower() if gpu_info else ""

    result = [0.0] * 8
    if 'nvidia' in gpu_str or 'geforce' in gpu_str or 'quadro' in gpu_str:
        result[0] = 1.0
    elif 'amd' in gpu_str or 'radeon' in gpu_str:
        result[1] = 1.0
    elif 'intel' in gpu_str:
        result[2] = 1.0
    elif 'apple' in gpu_str:
        result[3] = 1.0
    elif 'qualcomm' in gpu_str or 'adreno' in gpu_str:
        result[4] = 1.0
    elif 'arm' in gpu_str or 'mali' in gpu_str:
        result[5] = 1.0
    elif 'swiftshader' in gpu_str or 'software' in gpu_str or 'llvmpipe' in gpu_str:
        result[6] = 1.0
    else:
        result[7] = 1.0

    return result


def extract_vector(payload: Dict) -> List[float]:
    """
    Extract a feature vector from a fingerprint payload.

    Args:
        payload: The fingerprint payload dict containing 'fingerprint' key

    Returns:
        List of floats representing the fingerprint vector
    """
    vector = []

    # Get fingerprint sections
    fp = payload.get('fingerprint', payload)
    stable = fp.get('stable', {})
    loose = fp.get('loose', {})

    # Use stable metrics when available, fall back to loose
    navigator = stable.get('navigator', loose.get('navigator', {}))
    worker = stable.get('workerScope', loose.get('workerScope', {}))
    screen = loose.get('screen', {})  # Screen is in loose
    audio = stable.get('offlineAudioContext', loose.get('offlineAudioContext', {}))
    canvas = stable.get('canvas2d', loose.get('canvas2d', {}))
    webgl = stable.get('canvasWebgl', loose.get('canvasWebgl', {}))
    timezone = stable.get('timezone', loose.get('timezone', {}))
    headless = loose.get('headless', {})
    svg = loose.get('svg', {})
    resistance = loose.get('resistance', {})

    # =========================================================================
    # SECTION 1: Screen metrics (6 dims)
    # =========================================================================
    vector.append(normalize(safe_get(screen, 'width'), 0, SCREEN_MAX))
    vector.append(normalize(safe_get(screen, 'height'), 0, SCREEN_MAX))
    vector.append(normalize(safe_get(screen, 'availWidth'), 0, SCREEN_MAX))
    vector.append(normalize(safe_get(screen, 'availHeight'), 0, SCREEN_MAX))
    vector.append(normalize(safe_get(screen, 'colorDepth'), 0, COLOR_DEPTH_MAX))
    vector.append(normalize(safe_get(screen, 'pixelDepth'), 0, COLOR_DEPTH_MAX))

    # =========================================================================
    # SECTION 2: Hardware (4 dims)
    # =========================================================================
    vector.append(normalize(safe_get(navigator, 'hardwareConcurrency'), 1, HARDWARE_CONCURRENCY_MAX))
    vector.append(normalize(safe_get(navigator, 'deviceMemory', default=4), 0.25, MEMORY_MAX))
    vector.append(normalize(safe_get(navigator, 'maxTouchPoints'), 0, 10))
    vector.append(bool_to_float(safe_get(screen, 'touch')))

    # =========================================================================
    # SECTION 3: Audio fingerprint (6 summary + 50 samples = 56 dims)
    # =========================================================================
    # Audio summary metrics
    vector.append(normalize(safe_get(audio, 'compressorGainReduction'), -40, 0))
    vector.append(log_normalize(safe_get(audio, 'floatFrequencyDataSum'), 200000))
    vector.append(log_normalize(safe_get(audio, 'floatTimeDomainDataSum'), 200))
    vector.append(log_normalize(safe_get(audio, 'sampleSum'), 100))
    vector.append(normalize(safe_get(audio, 'totalUniqueSamples'), 0, 10000))
    vector.append(bool_to_float(safe_get(audio, 'noise')))

    # Audio samples (first 50 - these are highly discriminating)
    bins_sample = safe_get(audio, 'binsSample', default=[])
    if isinstance(bins_sample, list):
        for i in range(50):
            if i < len(bins_sample):
                # Samples are in -0.15 to 0.15 range, normalize to 0-1
                vector.append(normalize(bins_sample[i], -0.15, 0.15))
            else:
                vector.append(0.5)  # neutral value
    else:
        vector.extend([0.5] * 50)

    # =========================================================================
    # SECTION 4: Canvas/SVG metrics (5 dims)
    # =========================================================================
    vector.append(log_normalize(safe_get(canvas, 'textMetricsSystemSum'), 1))
    vector.append(log_normalize(safe_get(svg, 'svgrectSystemSum'), 1))
    vector.append(log_normalize(safe_get(svg, 'bBox'), 200000))
    vector.append(log_normalize(safe_get(svg, 'extentOfChar'), 1000))
    vector.append(log_normalize(safe_get(svg, 'computedTextLength'), 1000))

    # =========================================================================
    # SECTION 5: WebGL parameters (20 dims)
    # =========================================================================
    params = safe_get(webgl, 'parameters', default={})

    webgl_metrics = [
        ('MAX_TEXTURE_SIZE', 0, 32768),
        ('MAX_CUBE_MAP_TEXTURE_SIZE', 0, 32768),
        ('MAX_RENDERBUFFER_SIZE', 0, 32768),
        ('MAX_VERTEX_ATTRIBS', 0, 32),
        ('MAX_VERTEX_UNIFORM_VECTORS', 0, 8192),
        ('MAX_VARYING_VECTORS', 0, 64),
        ('MAX_COMBINED_TEXTURE_IMAGE_UNITS', 0, 64),
        ('MAX_VERTEX_TEXTURE_IMAGE_UNITS', 0, 32),
        ('MAX_TEXTURE_IMAGE_UNITS', 0, 32),
        ('MAX_FRAGMENT_UNIFORM_VECTORS', 0, 4096),
        ('MAX_3D_TEXTURE_SIZE', 0, 4096),
        ('MAX_DRAW_BUFFERS', 0, 16),
        ('MAX_SAMPLES', 0, 32),
        ('MAX_VERTEX_UNIFORM_BLOCKS', 0, 24),
        ('MAX_FRAGMENT_UNIFORM_BLOCKS', 0, 24),
        ('MAX_COMBINED_UNIFORM_BLOCKS', 0, 48),
        ('SUBPIXEL_BITS', 0, 8),
    ]

    for param_name, min_val, max_val in webgl_metrics:
        value = safe_get(params, param_name, default=0)
        vector.append(normalize(value, min_val, max_val))

    # MAX_VIEWPORT_DIMS (2 values)
    viewport_dims = safe_get(params, 'MAX_VIEWPORT_DIMS', default=[16384, 16384])
    if isinstance(viewport_dims, list) and len(viewport_dims) >= 2:
        vector.append(normalize(viewport_dims[0], 0, 65536))
        vector.append(normalize(viewport_dims[1], 0, 65536))
    else:
        vector.extend([0.5, 0.5])

    # antialias boolean
    vector.append(bool_to_float(safe_get(params, 'antialias')))

    # =========================================================================
    # SECTION 6: Timezone (2 dims)
    # =========================================================================
    vector.append(normalize(safe_get(timezone, 'offset'), -TIMEZONE_OFFSET_MAX, TIMEZONE_OFFSET_MAX))
    vector.append(normalize(safe_get(timezone, 'offsetComputed'), -TIMEZONE_OFFSET_MAX, TIMEZONE_OFFSET_MAX))

    # =========================================================================
    # SECTION 7: Headless detection (19 dims)
    # =========================================================================
    vector.append(normalize(safe_get(headless, 'likeHeadlessRating'), 0, 100))
    vector.append(normalize(safe_get(headless, 'headlessRating'), 0, 100))
    vector.append(normalize(safe_get(headless, 'stealthRating'), 0, 100))

    # likeHeadless signals (16 booleans)
    like_headless = safe_get(headless, 'likeHeadless', default={})
    like_headless_signals = [
        'noChrome', 'hasPermissionsBug', 'noPlugins', 'noMimeTypes',
        'notificationIsDenied', 'hasKnownBgColor', 'prefersLightColor', 'uaDataIsBlank',
        'pdfIsDisabled', 'noTaskbar', 'hasVvpScreenRes', 'hasSwiftShader',
        'noWebShare', 'noContentIndex', 'noContactsManager', 'noDownlinkMax'
    ]
    for signal in like_headless_signals:
        vector.append(bool_to_float(safe_get(like_headless, signal)))

    # =========================================================================
    # SECTION 8: Platform one-hot encoding (6 dims)
    # =========================================================================
    platform = safe_get(navigator, 'platform', default='')
    system = safe_get(navigator, 'system', default='')
    vector.extend(one_hot_platform(platform, system))

    # =========================================================================
    # SECTION 9: Engine one-hot encoding (4 dims)
    # =========================================================================
    engine = safe_get(resistance, 'engine', default='')
    user_agent = safe_get(navigator, 'userAgent', default='')
    worker_engine = safe_get(worker, 'userAgentEngine', default='')
    vector.extend(one_hot_engine(f"{engine} {worker_engine}", user_agent))

    # =========================================================================
    # SECTION 10: GPU vendor one-hot encoding (8 dims)
    # =========================================================================
    webgl_renderer = safe_get(params, 'UNMASKED_RENDERER_WEBGL', default='')
    if not webgl_renderer:
        webgl_renderer = safe_get(worker, 'webglRenderer', default='')
    vector.extend(one_hot_gpu_vendor(webgl_renderer))

    # =========================================================================
    # SECTION 11: Additional discriminating features (8 dims)
    # =========================================================================
    # chromium flag
    vector.append(bool_to_float(safe_get(headless, 'chromium')))

    # Font count (normalized)
    fonts = stable.get('fonts', loose.get('fonts', []))
    if isinstance(fonts, list):
        vector.append(normalize(len(fonts), 0, 100))
    else:
        vector.append(0.5)

    # WebGL extensions count
    extensions = safe_get(webgl, 'extensions', default=[])
    if isinstance(extensions, list):
        vector.append(normalize(len(extensions), 0, 60))
    else:
        vector.append(0.5)

    # WASM support
    wasm = stable.get('wasm', loose.get('wasm', {}))
    vector.append(bool_to_float(safe_get(wasm, 'simdSupported')))
    vector.append(normalize(safe_get(wasm, 'memCeiling'), 0, 4000))

    # Worker scope checks
    vector.append(bool_to_float(safe_get(worker, 'localeEntropyIsTrusty')))
    vector.append(bool_to_float(safe_get(worker, 'localeIntlEntropyIsTrusty')))
    vector.append(bool_to_float(safe_get(worker, 'uaPostReduction')))

    # Pad or truncate to exact dimension
    while len(vector) < VECTOR_DIM:
        vector.append(0.0)
    vector = vector[:VECTOR_DIM]

    return vector


def vector_to_debug(vector: List[float]) -> Dict[str, Any]:
    """Convert vector back to human-readable format for debugging."""
    idx = 0
    result = {}

    # Screen
    result['screen'] = {
        'width': vector[idx] * SCREEN_MAX,
        'height': vector[idx+1] * SCREEN_MAX,
        'availWidth': vector[idx+2] * SCREEN_MAX,
        'availHeight': vector[idx+3] * SCREEN_MAX,
        'colorDepth': vector[idx+4] * COLOR_DEPTH_MAX,
        'pixelDepth': vector[idx+5] * COLOR_DEPTH_MAX,
    }
    idx += 6

    # Hardware
    result['hardware'] = {
        'hardwareConcurrency': vector[idx] * HARDWARE_CONCURRENCY_MAX,
        'deviceMemory': vector[idx+1] * MEMORY_MAX,
        'maxTouchPoints': vector[idx+2] * 10,
        'touch': vector[idx+3] > 0.5,
    }
    idx += 4

    # Audio summary
    result['audio'] = {
        'compressorGainReduction': vector[idx] * 40 - 40,
        'samples_0': vector[idx+6] * 0.3 - 0.15,
    }
    idx += 56  # Skip all audio

    # Continue for other sections...
    # (abbreviated for brevity)

    return result


if __name__ == '__main__':
    # Test with sample data
    import json
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            payload = json.load(f)

        vector = extract_vector(payload)
        print(f"Vector dimension: {len(vector)}")
        print(f"Vector preview (first 20): {vector[:20]}")
        print(f"Vector stats: min={min(vector):.4f}, max={max(vector):.4f}, mean={sum(vector)/len(vector):.4f}")
