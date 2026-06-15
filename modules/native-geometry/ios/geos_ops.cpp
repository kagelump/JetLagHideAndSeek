// geos_ops.cpp — single-source GEOS op core (see geos_ops.h).
//
// Owns the lazily-initialized GEOS context and the one copy of the
// parse → validate → MakeValid → op → write → free pipeline shared by the iOS
// pod, the SPM test package, and the Android `.so`. Swift / Kotlin / JNI are
// thin marshalling shims over the functions declared in geos_ops.h.

#include "geos_ops.h"

#include "geos_c.h"

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>

namespace {

GeosOpsLogFn g_log = nullptr;

void emit_log(const char *message) {
    if (!message) return;
    if (g_log) {
        g_log(message);
    } else {
        std::fprintf(stderr, "[geos_ops] %s\n", message);
    }
}

void notice_handler(const char *fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt ? fmt : "(null)", args);
    va_end(args);
    emit_log(buf);
}

void error_handler(const char *fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt ? fmt : "(null)", args);
    va_end(args);
    emit_log(buf);
}

// Thread-safe, created once on first use. GEOS contexts are independent, so a
// separate Swift-side context (GeosCore.geosContext, used only by the XCTest
// verification path) can coexist with this one.
GEOSContextHandle_t get_context() {
    static std::once_flag flag;
    static GEOSContextHandle_t ctx = nullptr;
    std::call_once(flag, []() {
        ctx = GEOS_init_r();
        GEOSContext_setNoticeHandler_r(ctx, notice_handler);
        GEOSContext_setErrorHandler_r(ctx, error_handler);
    });
    return ctx;
}

const GeosWkbBuffer kEmptyBuffer = {nullptr, 0};

// Parse WKB and, if the geometry is invalid, recover it with MakeValid.
// Returns nullptr on parse or recovery failure (the caller treats that as the
// "no geometry" result). On success the returned handle is owned by the caller
// and must be destroyed with GEOSGeom_destroy_r.
GEOSGeometry *parse_and_validate(GEOSContextHandle_t ctx,
                                 const unsigned char *wkb, size_t len) {
    if (!wkb || len == 0) return nullptr;

    GEOSGeometry *geom = GEOSGeomFromWKB_buf_r(ctx, wkb, len);
    if (!geom) return nullptr;

    if (GEOSisValid_r(ctx, geom) != 1) {
        GEOSGeometry *fixed = GEOSMakeValid_r(ctx, geom);
        GEOSGeom_destroy_r(ctx, geom);
        return fixed;  // may be nullptr if MakeValid failed
    }
    return geom;
}

// Serialize a GEOS geometry to a freshly malloc'd WKB buffer (decoupled from
// the GEOS context so callers can free it without a handle). Returns the empty
// buffer on failure.
GeosWkbBuffer write_wkb(GEOSContextHandle_t ctx, const GEOSGeometry *geom) {
    size_t wkb_size = 0;
    unsigned char *geos_wkb = GEOSGeomToWKB_buf_r(ctx, geom, &wkb_size);
    if (!geos_wkb || wkb_size == 0) {
        if (geos_wkb) GEOSFree_r(ctx, geos_wkb);
        return kEmptyBuffer;
    }

    unsigned char *out = static_cast<unsigned char *>(std::malloc(wkb_size));
    if (out) std::memcpy(out, geos_wkb, wkb_size);
    GEOSFree_r(ctx, geos_wkb);

    if (!out) return kEmptyBuffer;
    return GeosWkbBuffer{out, wkb_size};
}

// Function-pointer shapes for the GEOS overlay ops.
using BinaryOp = GEOSGeometry *(*)(GEOSContextHandle_t, const GEOSGeometry *,
                                   const GEOSGeometry *);
using UnaryOp = GEOSGeometry *(*)(GEOSContextHandle_t, const GEOSGeometry *);

GeosWkbBuffer run_binary(const unsigned char *wkb_a, size_t len_a,
                         const unsigned char *wkb_b, size_t len_b,
                         BinaryOp op) {
    GEOSContextHandle_t ctx = get_context();

    GEOSGeometry *a = parse_and_validate(ctx, wkb_a, len_a);
    if (!a) return kEmptyBuffer;

    GEOSGeometry *b = parse_and_validate(ctx, wkb_b, len_b);
    if (!b) {
        GEOSGeom_destroy_r(ctx, a);
        return kEmptyBuffer;
    }

    GEOSGeometry *result = op(ctx, a, b);
    GEOSGeom_destroy_r(ctx, a);
    GEOSGeom_destroy_r(ctx, b);
    if (!result) return kEmptyBuffer;

    GeosWkbBuffer out = write_wkb(ctx, result);
    GEOSGeom_destroy_r(ctx, result);
    return out;
}

GeosWkbBuffer run_unary(const unsigned char *wkb, size_t len, UnaryOp op) {
    GEOSContextHandle_t ctx = get_context();

    GEOSGeometry *geom = parse_and_validate(ctx, wkb, len);
    if (!geom) return kEmptyBuffer;

    GEOSGeometry *result = op(ctx, geom);
    GEOSGeom_destroy_r(ctx, geom);
    if (!result) return kEmptyBuffer;

    GeosWkbBuffer out = write_wkb(ctx, result);
    GEOSGeom_destroy_r(ctx, result);
    return out;
}

}  // namespace

extern "C" {

void geos_ops_free(GeosWkbBuffer buffer) {
    if (buffer.data) std::free(buffer.data);
}

const char *geos_ops_version(void) {
    const char *v = GEOSversion();
    return v ? v : "unknown";
}

void geos_ops_set_log(GeosOpsLogFn fn) { g_log = fn; }

GeosWkbBuffer geos_ops_buffer(const unsigned char *wkb, size_t len,
                              double distance, int quadrant_segments) {
    GEOSContextHandle_t ctx = get_context();

    GEOSGeometry *geom = parse_and_validate(ctx, wkb, len);
    if (!geom) return kEmptyBuffer;

    GEOSBufferParams *params = GEOSBufferParams_create_r(ctx);
    if (!params) {
        GEOSGeom_destroy_r(ctx, geom);
        return kEmptyBuffer;
    }
    // JSTS-matching defaults: round cap, round join, mitre limit at GEOS
    // default.
    GEOSBufferParams_setQuadrantSegments_r(ctx, params, quadrant_segments);
    GEOSBufferParams_setEndCapStyle_r(ctx, params, GEOSBUF_CAP_ROUND);
    GEOSBufferParams_setJoinStyle_r(ctx, params, GEOSBUF_JOIN_ROUND);

    GEOSGeometry *buffered = GEOSBufferWithParams_r(ctx, geom, params, distance);
    GEOSBufferParams_destroy_r(ctx, params);
    GEOSGeom_destroy_r(ctx, geom);
    if (!buffered) return kEmptyBuffer;

    GeosWkbBuffer out = write_wkb(ctx, buffered);
    GEOSGeom_destroy_r(ctx, buffered);
    return out;
}

GeosWkbBuffer geos_ops_difference(const unsigned char *wkb_a, size_t len_a,
                                  const unsigned char *wkb_b, size_t len_b) {
    return run_binary(wkb_a, len_a, wkb_b, len_b, GEOSDifference_r);
}

GeosWkbBuffer geos_ops_union(const unsigned char *wkb_a, size_t len_a,
                             const unsigned char *wkb_b, size_t len_b) {
    return run_binary(wkb_a, len_a, wkb_b, len_b, GEOSUnion_r);
}

GeosWkbBuffer geos_ops_intersection(const unsigned char *wkb_a, size_t len_a,
                                    const unsigned char *wkb_b, size_t len_b) {
    return run_binary(wkb_a, len_a, wkb_b, len_b, GEOSIntersection_r);
}

GeosWkbBuffer geos_ops_unary_union(const unsigned char *wkb, size_t len) {
    return run_unary(wkb, len, GEOSUnaryUnion_r);
}

}  // extern "C"
