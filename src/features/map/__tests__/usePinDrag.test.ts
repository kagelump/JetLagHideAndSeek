import { act, renderHook } from "@testing-library/react-native";

import type { RadarQuestion } from "@/features/questions/radar/radarTypes";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";

import type { MapPin } from "../getQuestionPins";
import { usePinDrag } from "../usePinDrag";

function makeRadarQuestion(
    center: [number, number] = [139.65, 35.67],
): RadarQuestion {
    return {
        answer: "unanswered",
        center,
        createdAt: "2026-05-18T00:00:00.000Z",
        distanceMeters: 500,
        distanceOption: "500m",
        distanceUnit: "m",
        id: "radar-1",
        isLocked: false,
        type: "radar",
        updatedAt: "2026-05-18T00:00:00.000Z",
    };
}

function makeThermometerQuestion(
    previousPosition: [number, number] | null = [139.65, 35.67],
    currentPosition: [number, number] | null = [139.67, 35.69],
): ThermometerQuestion {
    return {
        answer: "unanswered",
        previousPosition,
        currentPosition,
        previousStation: null,
        currentStation: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        id: "thermometer-1",
        isLocked: false,
        type: "thermometer",
        updatedAt: "2026-05-18T00:00:00.000Z",
    };
}

function makePins(question: RadarQuestion | ThermometerQuestion): MapPin[] {
    if (question.type === "radar") {
        return [{ key: "center", position: question.center }];
    }
    const pins: MapPin[] = [];
    if (question.previousPosition) {
        pins.push({ key: "start", position: question.previousPosition });
    }
    if (question.currentPosition) {
        pins.push({ key: "end", position: question.currentPosition });
    }
    return pins;
}

describe("usePinDrag", () => {
    it("does not start dragging when the touch is far from the pin", async () => {
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn(),
                getPointInView: jest.fn().mockResolvedValue([100, 100]),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(makeRadarQuestion()),
                canMove: true,
                mapRef,
                onCommit,
                questionId: "radar-1",
            }),
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(200, 200);
        });

        expect(result.current.isDragging).toBe(false);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("starts dragging and commits when the touch is near the pin", async () => {
        const nextCenter: [number, number] = [139.7, 35.7];
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn().mockResolvedValue(nextCenter),
                getPointInView: jest.fn().mockResolvedValue([100, 100]),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(makeRadarQuestion([139.65, 35.67])),
                canMove: true,
                mapRef,
                onCommit,
                questionId: "radar-1",
            }),
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(120, 130);
        });
        expect(result.current.isDragging).toBe(true);

        await act(async () => {
            result.current.dragHandlers.handleDragUpdate(140, 150);
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });
        });

        await act(async () => {
            result.current.dragHandlers.handleDragEnd();
        });

        expect(onCommit).toHaveBeenCalledWith("radar-1", "center", nextCenter);
        expect(result.current.isDragging).toBe(false);
    });

    it("cleans up drag state when canMove becomes false", async () => {
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn(),
                getPointInView: jest.fn().mockResolvedValue([100, 100]),
            },
        };
        const onCommit = jest.fn();

        const { result, rerender } = renderHook(
            (props: { canMove: boolean }) =>
                usePinDrag({
                    pins: makePins(makeRadarQuestion()),
                    canMove: props.canMove,
                    mapRef,
                    onCommit,
                    questionId: "radar-1",
                }),
            { initialProps: { canMove: true } },
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(120, 130);
        });
        expect(result.current.isDragging).toBe(true);

        rerender({ canMove: false });
        expect(result.current.isDragging).toBe(false);
    });

    it("commits the closest pin key for thermometer", async () => {
        const question = makeThermometerQuestion(
            [139.65, 35.67],
            [139.67, 35.69],
        );
        const nextPos: [number, number] = [139.7, 35.7];
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn().mockResolvedValue(nextPos),
                getPointInView: jest
                    .fn()
                    .mockImplementation((coord: [number, number]) => {
                        // start pin at [100, 100], end pin at [200, 200]
                        if (coord[0] === 139.65)
                            return Promise.resolve([100, 100]);
                        return Promise.resolve([200, 200]);
                    }),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(question),
                canMove: true,
                mapRef,
                onCommit,
                questionId: "thermometer-1",
            }),
        );

        // Touch near end pin
        await act(async () => {
            await result.current.dragHandlers.handleDragStart(210, 210);
        });
        expect(result.current.isDragging).toBe(true);

        await act(async () => {
            result.current.dragHandlers.handleDragUpdate(210, 210);
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });
        });

        await act(async () => {
            result.current.dragHandlers.handleDragEnd();
        });

        expect(onCommit).toHaveBeenCalledWith("thermometer-1", "end", nextPos);
    });

    it("prefers end pin on tie-break when pins overlap", async () => {
        const question = makeThermometerQuestion(
            [139.65, 35.67],
            [139.65, 35.67],
        );
        const nextPos: [number, number] = [139.7, 35.7];
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn().mockResolvedValue(nextPos),
                getPointInView: jest.fn().mockResolvedValue([100, 100]),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(question),
                canMove: true,
                mapRef,
                onCommit,
                questionId: "thermometer-1",
            }),
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(120, 120);
        });
        expect(result.current.isDragging).toBe(true);

        await act(async () => {
            result.current.dragHandlers.handleDragUpdate(120, 120);
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });
        });

        await act(async () => {
            result.current.dragHandlers.handleDragEnd();
        });

        expect(onCommit).toHaveBeenCalledWith("thermometer-1", "end", nextPos);
    });

    it("does not start dragging when pins array is empty", async () => {
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn(),
                getPointInView: jest.fn(),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: [],
                canMove: true,
                mapRef,
                onCommit,
                questionId: "thermometer-1",
            }),
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(100, 100);
        });

        expect(result.current.isDragging).toBe(false);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("does not commit when questionId is null", async () => {
        const nextPos: [number, number] = [139.7, 35.7];
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn().mockResolvedValue(nextPos),
                getPointInView: jest.fn().mockResolvedValue([100, 100]),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(makeRadarQuestion()),
                canMove: true,
                mapRef,
                onCommit,
                questionId: null,
            }),
        );

        await act(async () => {
            await result.current.dragHandlers.handleDragStart(120, 130);
        });
        expect(result.current.isDragging).toBe(true);

        await act(async () => {
            result.current.dragHandlers.handleDragUpdate(120, 130);
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });
        });

        await act(async () => {
            result.current.dragHandlers.handleDragEnd();
        });

        expect(onCommit).not.toHaveBeenCalled();
    });

    it("commits start pin when touch is closer to start", async () => {
        const question = makeThermometerQuestion(
            [139.65, 35.67],
            [139.67, 35.69],
        );
        const nextPos: [number, number] = [139.7, 35.7];
        const mapRef = {
            current: {
                getCoordinateFromView: jest.fn().mockResolvedValue(nextPos),
                getPointInView: jest
                    .fn()
                    .mockImplementation((coord: [number, number]) => {
                        if (coord[0] === 139.65)
                            return Promise.resolve([100, 100]);
                        return Promise.resolve([200, 200]);
                    }),
            },
        };
        const onCommit = jest.fn();

        const { result } = renderHook(() =>
            usePinDrag({
                pins: makePins(question),
                canMove: true,
                mapRef,
                onCommit,
                questionId: "thermometer-1",
            }),
        );

        // Touch near start pin
        await act(async () => {
            await result.current.dragHandlers.handleDragStart(110, 110);
        });
        expect(result.current.isDragging).toBe(true);

        await act(async () => {
            result.current.dragHandlers.handleDragUpdate(110, 110);
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });
        });

        await act(async () => {
            result.current.dragHandlers.handleDragEnd();
        });

        expect(onCommit).toHaveBeenCalledWith(
            "thermometer-1",
            "start",
            nextPos,
        );
    });
});
