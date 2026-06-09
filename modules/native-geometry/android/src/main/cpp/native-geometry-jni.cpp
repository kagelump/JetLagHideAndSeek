// native-geometry-jni.cpp — JNI bridge to the GEOS C API.
//
// G2 production: exposes geosVersion() and bufferWKB() so the Expo Module
// can run real GEOS buffer operations.

#include <jni.h>
#include <android/log.h>
#include <string>
#include <cstring>
#include <mutex>

// GEOS C API — header shipped alongside the pre-built .a.
#include "geos_c.h"

#define TAG "NativeGeometry-JNI"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// ─── Context management ────────────────────────────────────────────────────

static GEOSContextHandle_t getOrCreateContext() {
    static std::once_flag ctxFlag;
    static GEOSContextHandle_t ctx = nullptr;

    std::call_once(ctxFlag, []() {
        ctx = GEOS_init_r();

        // Install notice/error handlers that log to Android logcat.
        GEOSContext_setNoticeMessageHandler_r(ctx,
            [](const char* msg, void*) {
                LOGD("GEOS notice: %s", msg ? msg : "(null)");
            }, nullptr);

        GEOSContext_setErrorMessageHandler_r(ctx,
            [](const char* msg, void*) {
                LOGE("GEOS error: %s", msg ? msg : "(null)");
            }, nullptr);
    });

    return ctx;
}

// ─── Shared: buffer a GEOS geometry and return WKB ─────────────────────────

static jbyteArray bufferAndWrite(JNIEnv* env, GEOSContextHandle_t ctx,
    GEOSGeometry* geom, jdouble distance, jint quadrantSegments) {

    // Create buffer params with JSTS-matching defaults.
    auto* params = GEOSBufferParams_create_r(ctx);
    if (!params) {
        LOGE("bufferWKB: failed to create buffer params");
        return nullptr;
    }

    GEOSBufferParams_setQuadrantSegments_r(ctx, params, quadrantSegments);
    GEOSBufferParams_setEndCapStyle_r(ctx, params, GEOSBUF_CAP_ROUND);
    GEOSBufferParams_setJoinStyle_r(ctx, params, GEOSBUF_JOIN_ROUND);
    // Mitre limit left at GEOS default (matches JSTS default).

    auto* buffered = GEOSBufferWithParams_r(ctx, geom, params, distance);
    GEOSBufferParams_destroy_r(ctx, params);

    if (!buffered) {
        LOGE("bufferWKB: GEOSBufferWithParams_r failed");
        return nullptr;
    }

    // Write GEOS geometry → WKB.
    size_t wkbOutSize = 0;
    auto* wkbOut = GEOSGeomToWKB_buf_r(ctx, buffered, &wkbOutSize);
    GEOSGeom_destroy_r(ctx, buffered);

    if (!wkbOut || wkbOutSize == 0) {
        LOGE("bufferWKB: failed to write output WKB");
        return nullptr;
    }

    // Allocate the Java byte array before freeing the C buffer, so that
    // an OOM from NewByteArray doesn't leak wkbOut (if NewByteArray throws,
    // the JNI call unwinds without returning — but on most VMs it returns
    // NULL with a pending exception, so we handle both).
    jbyteArray result = env->NewByteArray(static_cast<jsize>(wkbOutSize));
    if (result) {
        env->SetByteArrayRegion(result, 0, static_cast<jsize>(wkbOutSize),
            reinterpret_cast<const jbyte*>(wkbOut));
    }
    GEOSFree_r(ctx, wkbOut);

    if (!result) {
        LOGE("bufferWKB: failed to allocate output byte array");
        return nullptr;
    }

    LOGD("bufferWKB: success, output WKB size=%zu", wkbOutSize);
    return result;
}

// ─── JNI exports ───────────────────────────────────────────────────────────

extern "C" {

JNIEXPORT jstring JNICALL
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeGeosVersion(
    JNIEnv* env, jobject /* thiz */) {

    const char* version = GEOSversion();
    if (!version) {
        return env->NewStringUTF("unknown");
    }
    return env->NewStringUTF(version);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeBufferWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkb,
    jdouble distance, jint quadrantSegments) {

    auto* ctx = getOrCreateContext();

    // --- Read input WKB ----------------------------------------------------
    jsize wkbLen = env->GetArrayLength(wkb);
    if (wkbLen == 0) {
        LOGE("bufferWKB: empty WKB input");
        return nullptr;
    }

    jbyte* wkbBytes = env->GetByteArrayElements(wkb, nullptr);
    if (!wkbBytes) {
        LOGE("bufferWKB: failed to get WKB bytes");
        return nullptr;
    }

    auto* inGeom = GEOSGeomFromWKB_buf_r(ctx,
        reinterpret_cast<const unsigned char*>(wkbBytes),
        static_cast<size_t>(wkbLen));
    env->ReleaseByteArrayElements(wkb, wkbBytes, JNI_ABORT);

    if (!inGeom) {
        LOGE("bufferWKB: failed to parse WKB");
        return nullptr;
    }

    // --- Validate / fix ----------------------------------------------------
    char isValid = 0;
    GEOSisValid_r(ctx, inGeom, &isValid);
    if (isValid != 1) {
        LOGD("bufferWKB: geometry invalid (GEOSisValid_r returned %d) — attempting MakeValid", (int)isValid);
        auto* fixed = GEOSMakeValid_r(ctx, inGeom);
        GEOSGeom_destroy_r(ctx, inGeom);
        if (!fixed) {
            LOGE("bufferWKB: MakeValid failed");
            return nullptr;
        }
        inGeom = fixed;
    }

    // --- Buffer ------------------------------------------------------------
    jbyteArray result = bufferAndWrite(env, ctx, inGeom, distance, quadrantSegments);
    GEOSGeom_destroy_r(ctx, inGeom);

    return result;
}

} // extern "C"
