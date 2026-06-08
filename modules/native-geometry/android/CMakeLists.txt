cmake_minimum_required(VERSION 3.22.1)
project("native-geometry")

# Pre-built GEOS static library path (per ABI).
# The ABI is set by Gradle's externalNativeBuild; we use it
# to find the right pre-built .a.
set(GEOS_LIB_DIR "${CMAKE_SOURCE_DIR}/../libs/${ANDROID_ABI}")
set(GEOS_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/../libs/include")

# Import the pre-built GEOS static library.
add_library(geos STATIC IMPORTED)
set_target_properties(geos PROPERTIES
    IMPORTED_LOCATION "${GEOS_LIB_DIR}/libgeos.a"
)

# JNI wrapper shared library.
add_library(native-geometry-jni SHARED
    src/main/cpp/native-geometry-jni.cpp
)

target_include_directories(native-geometry-jni PRIVATE
    ${GEOS_INCLUDE_DIR}
)

target_link_libraries(native-geometry-jni
    geos
    c++_shared
    log
)
