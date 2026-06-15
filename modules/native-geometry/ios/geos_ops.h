// geos_ops.h — single-source GEOS op core (C ABI).
//
// This is the ONE implementation of the
//   parse WKB → GEOSisValid_r → GEOSMakeValid_r recovery → run op →
//   GEOSGeomToWKB_buf → free
// state machine. It is compiled into every native target:
//   - the iOS pod + the SPM test package (Swift calls it via geos_bridge.h),
//   - the Android `.so` (the JNI layer marshals jbyteArray ↔ buffers).
//
// Before this existed the same sequence was hand-written in Swift
// (GeosCore.swift), C++/JNI (native-geometry-jni.cpp), and wasm-JS
// (geosWasmNode.ts) — four surfaces to keep in lockstep. The canonical file
// lives under `ios/` (matching the `ios/GeosCore.swift` convention) and is
// symlinked into `Sources/CGEOS/` and `android/src/main/cpp/`.
//
// All entry points are `extern "C"` so Swift can import them as plain C
// functions through the GEOS module map. The C++ implementation lives in
// geos_ops.cpp.

#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// A heap-allocated WKB buffer owned by the caller. `data == NULL` (and
// `size == 0`) signals failure OR an empty/null result — callers treat both as
// "no geometry", matching the prior `nil` return of every implementation.
//
// `data` is allocated with malloc and MUST be released with geos_ops_free once
// copied out (into Swift `Data` / a JNI `jbyteArray`). It is intentionally not
// a GEOS-context-owned pointer, so callers need no GEOS handle to free it.
typedef struct GeosWkbBuffer {
    unsigned char *data;
    size_t size;
} GeosWkbBuffer;

// Release a buffer returned by any geos_ops_* op. Safe to call with data==NULL.
void geos_ops_free(GeosWkbBuffer buffer);

// GEOS version string (e.g. "3.14.1-CAPI-1.20.0"). Statically owned by GEOS —
// do not free.
const char *geos_ops_version(void);

// Optional log sink for GEOS notice/error handler output. If unset, messages
// go to stderr. Platforms install their own (NSLog on iOS, __android_log on
// Android) so GEOS diagnostics keep flowing to the native console. The op
// functions themselves do NOT log on the success path.
typedef void (*GeosOpsLogFn)(const char *message);
void geos_ops_set_log(GeosOpsLogFn fn);

// Buffer `wkb` by `distance` with `quadrant_segments` arc fidelity
// (round cap, round join — matches the prior JSTS-compatible defaults).
GeosWkbBuffer geos_ops_buffer(const unsigned char *wkb, size_t len,
                              double distance, int quadrant_segments);

// Binary overlay ops. Both inputs are parsed and (if invalid) MakeValid-
// recovered before the op runs.
GeosWkbBuffer geos_ops_difference(const unsigned char *wkb_a, size_t len_a,
                                  const unsigned char *wkb_b, size_t len_b);
GeosWkbBuffer geos_ops_union(const unsigned char *wkb_a, size_t len_a,
                             const unsigned char *wkb_b, size_t len_b);
GeosWkbBuffer geos_ops_intersection(const unsigned char *wkb_a, size_t len_a,
                                    const unsigned char *wkb_b, size_t len_b);

// Unary union of a single (possibly multi-) geometry.
GeosWkbBuffer geos_ops_unary_union(const unsigned char *wkb, size_t len);

#ifdef __cplusplus
}  // extern "C"
#endif
