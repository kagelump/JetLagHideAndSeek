package expo.modules.nativegeometry

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * Instrumented parity suite for the Android side of the native GEOS backend
 * (WI-4). Runs on an emulator/device against the **real vendored GEOS 3.14.1
 * binary** through [GeosBridge] — no Metro, no JS bundle, no RN bridge.
 *
 * It loads the same committed, language-neutral golden fixture that gates the
 * host (geos-wasm) suite and the iOS XCTest suite — `__fixtures__/geos-golden.json`,
 * wired in as an androidTest asset by build.gradle — and asserts each case
 * against engine-independent invariants (type / area+ratioTol / bbox+tolM /
 * isNull / minRingVertices / numCoords). This closes the Kotlin axis of the
 * cross-engine parity (research C1) and guards the stale-binary / ABI traps.
 *
 * Kotlin has no direct GEOS bindings (only the five JNI ops), so result WKB is
 * decoded by the small [WkbInfo] reader below — planar shoelace area to match
 * GEOS's Cartesian `GEOSArea`, bbox over all coordinates, and total coordinate
 * count to match `GEOSGetNumCoordinates`.
 */
@RunWith(AndroidJUnit4::class)
class GeosBridgeTest {

    // ── Golden fixture loading ──────────────────────────────────────────────

    data class GoldenCase(
        val name: String,
        val op: String,
        val inputWkbHex: List<String>,
        val distance: Double?,
        val quadrantSegments: Int?,
        val isNull: Boolean,
        val resultType: String?,
        val areaValue: Double?,
        val areaRatioTol: Double?,
        val bbox: DoubleArray?,
        val bboxTolM: Double?,
        val minRingVertices: Int?,
        val numCoords: Int?
    )

    companion object {
        val goldenCases: List<GoldenCase> by lazy { loadGoldenCases() }

        private fun loadGoldenCases(): List<GoldenCase> {
            val ctx = InstrumentationRegistry.getInstrumentation().context
            val json = ctx.assets.open("geos-golden.json").bufferedReader().use { it.readText() }
            val root = JSONObject(json)
            val cases = root.getJSONArray("cases")
            val out = ArrayList<GoldenCase>(cases.length())
            for (i in 0 until cases.length()) {
                val c = cases.getJSONObject(i)
                val expect = c.getJSONObject("expect")
                val params = c.optJSONObject("params")
                val inputs = c.optJSONArray("inputWkbHex")
                val hexes = ArrayList<String>()
                if (inputs != null) for (j in 0 until inputs.length()) hexes.add(inputs.getString(j))

                val area = expect.optJSONObject("areaM2")
                val bboxArr = expect.optJSONArray("bbox")
                val bbox = if (bboxArr != null) {
                    DoubleArray(bboxArr.length()) { bboxArr.getDouble(it) }
                } else null

                out.add(
                    GoldenCase(
                        name = c.getString("name"),
                        op = c.getString("op"),
                        inputWkbHex = hexes,
                        distance = params?.optDouble("distance"),
                        quadrantSegments = if (params != null && params.has("quadrantSegments"))
                            params.getInt("quadrantSegments") else null,
                        isNull = expect.optBoolean("isNull", false),
                        resultType = if (expect.has("resultType") && !expect.isNull("resultType"))
                            expect.getString("resultType") else null,
                        areaValue = area?.getDouble("value"),
                        areaRatioTol = area?.getDouble("ratioTol"),
                        bbox = bbox,
                        bboxTolM = if (expect.has("bboxTolM") && !expect.isNull("bboxTolM"))
                            expect.getDouble("bboxTolM") else null,
                        minRingVertices = if (expect.has("minRingVertices") && !expect.isNull("minRingVertices"))
                            expect.getInt("minRingVertices") else null,
                        numCoords = if (expect.has("numCoords") && !expect.isNull("numCoords"))
                            expect.getInt("numCoords") else null
                    )
                )
            }
            return out
        }
    }

    private fun runOp(c: GoldenCase): ByteArray? {
        val inputs = c.inputWkbHex.map { hexToBytes(it) }
        return when (c.op) {
            "buffer" -> GeosBridge.buffer(inputs[0], c.distance!!, c.quadrantSegments ?: 8)
            "difference" -> GeosBridge.difference(inputs[0], inputs[1])
            "intersection" -> GeosBridge.intersection(inputs[0], inputs[1])
            "union" -> GeosBridge.union(inputs[0], inputs[1])
            "unaryUnion" -> GeosBridge.unaryUnion(inputs[0])
            // Parse cases run through unaryUnion (a no-op identity for already-valid
            // single geometries) to exercise the WKB read→write round-trip.
            "parse" -> GeosBridge.unaryUnion(inputs[0])
            else -> throw IllegalArgumentException("Unknown op: ${c.op}")
        }
    }

    // ── Diagnostics ─────────────────────────────────────────────────────────

    @Test
    fun versionStartsWith3_14() {
        val v = GeosBridge.version()
        assertTrue("Expected GEOS 3.14.x, got $v", v.startsWith("3.14"))
    }

    /** All five ops return non-null on a known-good square — stale-binary guard. */
    @Test
    fun allOpsPresent() {
        val square = hexToBytes(goldenCases.first { it.op == "buffer" }.inputWkbHex[0])
        assertNotNull("buffer returned null", GeosBridge.buffer(square, 1.0, 8))
        assertNotNull("difference returned null", GeosBridge.difference(square, square))
        assertNotNull("union returned null", GeosBridge.union(square, square))
        assertNotNull("intersection returned null", GeosBridge.intersection(square, square))
        assertNotNull("unaryUnion returned null", GeosBridge.unaryUnion(square))
    }

    @Test
    fun abiVersionMatches() {
        // Keep in sync with modules/native-geometry/abi-version.json
        assertEquals(2, GeosBridge.NATIVE_ABI_VERSION)
    }

    // ── Golden fixture parity (one test per op) ─────────────────────────────

    @Test fun bufferCases() = runCasesForOp("buffer")
    @Test fun differenceCases() = runCasesForOp("difference")
    @Test fun intersectionCases() = runCasesForOp("intersection")
    @Test fun unionCases() = runCasesForOp("union")
    @Test fun unaryUnionCases() = runCasesForOp("unaryUnion")
    @Test fun parseCases() = runCasesForOp("parse")

    private fun runCasesForOp(op: String) {
        val cases = goldenCases.filter { it.op == op }
        assertFalse("No $op cases in golden fixture", cases.isEmpty())
        for (c in cases) assertGoldenCase(c)
    }

    private fun assertGoldenCase(c: GoldenCase) {
        val result = runOp(c)

        if (c.isNull) {
            assertEmptyOrNull(result, c.name)
            return
        }

        assertNotNull("${c.name}: expected non-null result", result)
        val info = WkbInfo.parse(result!!)
        assertFalse("${c.name}: expected non-empty result", info.isEmpty)

        c.resultType?.let {
            assertEquals("${c.name}: type mismatch", it, info.typeName)
        }

        if (c.areaValue != null && c.areaRatioTol != null) {
            assertTrue("${c.name}: negative area ${info.area}", info.area >= 0)
            val ratio = info.area / c.areaValue
            assertEquals(
                "${c.name}: area ratio $ratio outside tolerance ${c.areaRatioTol}",
                1.0, ratio, c.areaRatioTol
            )
        }

        if (c.bbox != null && c.bboxTolM != null) {
            val tol = c.bboxTolM + 1e-9 // float-noise floor; bboxTolM is 0 for exact-roundtrip parse cases
            val b = info.bbox!!
            assertEquals("${c.name}: bbox xmin", c.bbox[0], b[0], tol)
            assertEquals("${c.name}: bbox ymin", c.bbox[1], b[1], tol)
            assertEquals("${c.name}: bbox xmax", c.bbox[2], b[2], tol)
            assertEquals("${c.name}: bbox ymax", c.bbox[3], b[3], tol)
        }

        c.minRingVertices?.let {
            assertTrue(
                "${c.name}: min ring vertices ${info.minRingVertices} < $it",
                info.minRingVertices >= it
            )
        }

        c.numCoords?.let {
            assertEquals("${c.name}: numCoords", it, info.numCoords)
        }
    }

    // ── Empty-result semantics (GEOS 3.14 returns empty geometry, not null) ──

    @Test
    fun disjointIntersectionIsEmpty() {
        val c = goldenCases.first { it.name == "intersection/disjoint-empty" }
        val wkbs = c.inputWkbHex.map { hexToBytes(it) }
        assertEmptyOrNull(GeosBridge.intersection(wkbs[0], wkbs[1]), c.name)
    }

    @Test
    fun differenceAInsideBIsEmpty() {
        val c = goldenCases.first { it.name == "difference/a-inside-b-empty" }
        val wkbs = c.inputWkbHex.map { hexToBytes(it) }
        assertEmptyOrNull(GeosBridge.difference(wkbs[0], wkbs[1]), c.name)
    }

    // ── MakeValid recovery ──────────────────────────────────────────────────

    @Test
    fun makeValidRecovery() {
        // Self-intersecting bowtie: (0,0)->(2,2)->(2,0)->(0,2)->(0,0)
        val bowtie = "010300000001000000050000000000000000000000000000000000000000000000000000400000000000000040000000000000004000000000000000000000000000000000000000000000004000000000000000000000000000000000"
        val result = GeosBridge.unaryUnion(hexToBytes(bowtie))
        assertNotNull("MakeValid + unaryUnion on bowtie should not crash or return null", result)
    }

    // ── Memory stress (1000 iterations) ─────────────────────────────────────

    @Test
    fun memoryStressBuffer() {
        val square = hexToBytes(goldenCases.first { it.op == "buffer" }.inputWkbHex[0])
        for (i in 0 until 1000) {
            assertNotNull("Buffer failed at iteration $i", GeosBridge.buffer(square, 100.0, 8))
        }
    }

    @Test
    fun memoryStressOverlay() {
        val diff = goldenCases.first { it.name == "difference/square-with-hole" }
        val a = hexToBytes(diff.inputWkbHex[0])
        val b = hexToBytes(diff.inputWkbHex[1])
        for (i in 0 until 1000) {
            assertNotNull("Difference failed at $i", GeosBridge.difference(a, b))
            assertNotNull("Union failed at $i", GeosBridge.union(a, b))
            assertNotNull("Intersection failed at $i", GeosBridge.intersection(a, b))
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** A result is acceptable as "null" if it is null or decodes to an empty geometry. */
    private fun assertEmptyOrNull(result: ByteArray?, name: String) {
        if (result == null) return
        val info = WkbInfo.parse(result)
        assertTrue("$name: expected empty or null result, got non-empty geometry", info.isEmpty)
    }

    private fun hexToBytes(hex: String): ByteArray {
        val h = if (hex.startsWith("0x")) hex.substring(2) else hex
        require(h.length % 2 == 0) { "odd-length hex" }
        return ByteArray(h.length / 2) {
            ((Character.digit(h[it * 2], 16) shl 4) + Character.digit(h[it * 2 + 1], 16)).toByte()
        }
    }

    /**
     * Minimal WKB decoder collecting the invariants the golden fixture asserts.
     * Handles standard 2D WKB (types 1–7), recursing into Multi-part and
     * GeometryCollection geometries and honoring the per-geometry byte-order
     * flag. Area uses the planar shoelace
     * (matching GEOS's Cartesian `GEOSArea`): exterior ring minus holes, summed
     * over polygons.
     */
    class WkbInfo private constructor() {
        var topTypeId = -1
        var numCoords = 0
        var area = 0.0
        var minRingVertices = Int.MAX_VALUE
        private var minX = Double.POSITIVE_INFINITY
        private var minY = Double.POSITIVE_INFINITY
        private var maxX = Double.NEGATIVE_INFINITY
        private var maxY = Double.NEGATIVE_INFINITY

        val isEmpty: Boolean get() = numCoords == 0
        val bbox: DoubleArray? get() = if (isEmpty) null else doubleArrayOf(minX, minY, maxX, maxY)

        val typeName: String
            get() = when (topTypeId) {
                1 -> "Point"
                2 -> "LineString"
                3 -> "Polygon"
                4 -> "MultiPoint"
                5 -> "MultiLineString"
                6 -> "MultiPolygon"
                7 -> "GeometryCollection"
                else -> "Unknown($topTypeId)"
            }

        companion object {
            fun parse(bytes: ByteArray): WkbInfo {
                val info = WkbInfo()
                val cur = Cursor(bytes)
                info.topTypeId = info.readGeom(cur)
                return info
            }
        }

        private fun addCoord(x: Double, y: Double) {
            if (x.isNaN() || y.isNaN()) return // POINT EMPTY etc.
            numCoords++
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }

        /** Reads one geometry (with its own endianness header); returns its type id. */
        private fun readGeom(c: Cursor): Int {
            c.little = c.u8() == 1
            // Mask EWKB Z/M/SRID flags; the fixtures are plain 2D so this is defensive.
            val type = (c.u32() and 0xFF).toInt()
            when (type) {
                1 -> addCoord(c.f64(), c.f64())
                2 -> {
                    val n = c.u32().toInt()
                    repeat(n) { addCoord(c.f64(), c.f64()) }
                }
                3 -> {
                    val rings = c.u32().toInt()
                    for (ring in 0 until rings) {
                        val nPts = c.u32().toInt()
                        val xs = DoubleArray(nPts)
                        val ys = DoubleArray(nPts)
                        for (i in 0 until nPts) {
                            val x = c.f64(); val y = c.f64()
                            xs[i] = x; ys[i] = y
                            addCoord(x, y)
                        }
                        if (nPts < minRingVertices) minRingVertices = nPts
                        val ringArea = abs(shoelace(xs, ys))
                        if (ring == 0) area += ringArea else area -= ringArea
                    }
                }
                4, 5, 6, 7 -> {
                    val n = c.u32().toInt()
                    repeat(n) { readGeom(c) }
                }
                else -> throw IllegalArgumentException("Unsupported WKB type $type")
            }
            return type
        }

        private fun shoelace(xs: DoubleArray, ys: DoubleArray): Double {
            var sum = 0.0
            val n = xs.size
            for (i in 0 until n) {
                val j = (i + 1) % n
                sum += xs[i] * ys[j] - xs[j] * ys[i]
            }
            return sum / 2.0
        }

        private class Cursor(val bytes: ByteArray) {
            var pos = 0
            var little = true

            fun u8(): Int = bytes[pos++].toInt() and 0xFF

            fun u32(): Long {
                var v = 0L
                if (little) for (i in 0..3) v = v or ((bytes[pos + i].toLong() and 0xFF) shl (8 * i))
                else for (i in 0..3) v = (v shl 8) or (bytes[pos + i].toLong() and 0xFF)
                pos += 4
                return v
            }

            fun f64(): Double {
                var v = 0L
                if (little) for (i in 0..7) v = v or ((bytes[pos + i].toLong() and 0xFF) shl (8 * i))
                else for (i in 0..7) v = (v shl 8) or (bytes[pos + i].toLong() and 0xFF)
                pos += 8
                return Double.fromBits(v)
            }
        }
    }
}
