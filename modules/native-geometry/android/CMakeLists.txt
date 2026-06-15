cmake_minimum_required(VERSION 3.22.1)
project("native-geometry")

# Pre-built GEOS static library path (per ABI).
# The ABI is set by Gradle's externalNativeBuild; we use it
# to find the right pre-built .a.
set(GEOS_LIB_DIR "${CMAKE_SOURCE_DIR}/libs/${ANDROID_ABI}")
set(GEOS_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/libs/include")

# Import the pre-built GEOS static library.
add_library(geos STATIC IMPORTED)
set_target_properties(geos PROPERTIES
    IMPORTED_LOCATION "${GEOS_LIB_DIR}/libgeos.a"
)

# JNI wrapper shared library. native-geometry-jni.cpp is a thin marshalling
# shim; the GEOS op pipeline lives in the shared core geos_ops.cpp (symlinked
# from ios/geos_ops.cpp — the single source compiled into every native target).
add_library(native-geometry-jni SHARED
    src/main/cpp/native-geometry-jni.cpp
    src/main/cpp/geos_ops.cpp
)

target_include_directories(native-geometry-jni PRIVATE
    ${GEOS_INCLUDE_DIR}
)

# Pin C++17 (the shared core geos_ops.cpp uses lambdas, brace-init,
# std::call_once). Matches the SPM target + pod so the one core builds
# identically everywhere.
target_compile_features(native-geometry-jni PRIVATE cxx_std_17)

target_link_libraries(native-geometry-jni
    geos
    c++_shared
    log
)

# Align ELF segments to 16 KB so the .so is compatible with
# Android 15+ devices that use a 16 KB page size.
target_link_options(native-geometry-jni PRIVATE
    -Wl,-z,max-page-size=16384
)

# ── Address Sanitizer (dev-only, off by default) ─────────────────────────
# Enable with: ./gradlew ... -PenableAddressSanitizer=true
# The Gradle build.gradle passes -DENABLE_ASAN=ON when the property is set.
if(ENABLE_ASAN)
    target_compile_options(native-geometry-jni PRIVATE
        -fsanitize=address -fno-omit-frame-pointer
    )
    target_link_options(native-geometry-jni PRIVATE
        -fsanitize=address
    )
    # The imported GEOS library isn't compiled with ASan, so we can't
    # catch errors inside GEOS itself — but we can catch double-frees
    # and use-after-free on the JNI side (the GEOS handle management).
    message(STATUS "native-geometry: Address Sanitizer enabled")
endif()
