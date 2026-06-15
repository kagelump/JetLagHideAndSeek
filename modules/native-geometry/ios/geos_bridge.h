// geos_bridge.h — umbrella header for the GEOS C API.
//
// The GEOS xcframework ships geos_c.h in its Headers/ directory.
// This bridge header lets Swift import the C API via the module map.
#pragma once
#include "geos_c.h"
// Single-source GEOS op core (parse/validate/op/write/free). Including it here
// exposes the geos_ops_* C functions to Swift via the GEOS module map, so
// GeosCore.swift can call them instead of reimplementing the pipeline.
#include "geos_ops.h"
