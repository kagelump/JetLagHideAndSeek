import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import type { MapPin } from "./getQuestionPins";

import type { Position } from "./geojsonTypes";
import { MAP } from "@/config/appConfig";

const PIN_HIT_RADIUS_PX = MAP.pinHitRadiusPx;

export type PinDragHandlers = {
    handleDragEnd: () => void;
    handleDragFinalize: () => void;
    handleDragStart: (absoluteX: number, absoluteY: number) => Promise<void>;
    handleDragUpdate: (absoluteX: number, absoluteY: number) => void;
};

export type PinDragState = {
    draftCoordinate: Position | null;
    draggedPinKey: string | null;
    dragHandlers: PinDragHandlers;
    gesture: ReturnType<typeof Gesture.Pan>;
    isDragging: boolean;
    revision: number;
};

type UsePinDragOptions = {
    activePinKey?: string | null;
    pins: MapPin[];
    canMove: boolean;
    mapRef: RefObject<{
        getCoordinateFromView: (point: [number, number]) => Promise<Position>;
        getPointInView: (coordinate: Position) => Promise<[number, number]>;
    } | null>;
    onCommit: (questionId: string, pinKey: string, position: Position) => void;
    questionId: string | null;
};

export function usePinDrag({
    activePinKey,
    pins,
    canMove,
    mapRef,
    onCommit,
    questionId,
}: UsePinDragOptions): PinDragState {
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const draftPinCoordinateRef = useRef<Position | null>(null);
    const draggedPinKeyRef = useRef<string | null>(null);
    const rafRef = useRef<number | null>(null);
    const [tick, setTick] = useState(0);
    const draftCoordinate = isDragging ? draftPinCoordinateRef.current : null;

    const cleanupDrag = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
        draftPinCoordinateRef.current = null;
        draggedPinKeyRef.current = null;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!canMove) {
            cleanupDrag();
        }
    }, [canMove, cleanupDrag]);

    useEffect(() => {
        return () => {
            cleanupDrag();
        };
    }, [cleanupDrag]);

    const updateDraftCoordinate = useCallback(
        (screenX: number, screenY: number) => {
            if (rafRef.current !== null) return;
            rafRef.current = requestAnimationFrame(async () => {
                rafRef.current = null;
                try {
                    const coordinate =
                        await mapRef.current?.getCoordinateFromView([
                            screenX,
                            screenY,
                        ]);
                    if (isDraggingRef.current && coordinate) {
                        draftPinCoordinateRef.current = coordinate;
                        setTick((t) => t + 1);
                    }
                } catch {
                    // ignore projection errors during drag
                }
            });
        },
        [mapRef],
    );

    const handleDragStart = useCallback(
        async (absoluteX: number, absoluteY: number) => {
            if (!mapRef.current || pins.length === 0) {
                isDraggingRef.current = false;
                return;
            }
            try {
                const pinScreenPositions = await Promise.all(
                    pins.map(async (pin) => ({
                        pin,
                        screenPoint: await mapRef.current!.getPointInView(
                            pin.position,
                        ),
                    })),
                );

                let closestPin: MapPin | null = null;
                let closestDist = Infinity;

                for (const { pin, screenPoint } of pinScreenPositions) {
                    const dx = absoluteX - screenPoint[0];
                    const dy = absoluteY - screenPoint[1];
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist <= PIN_HIT_RADIUS_PX) {
                        if (dist <= closestDist) {
                            closestDist = dist;
                            closestPin = pin;
                        }
                    }
                }

                if (closestPin) {
                    if (activePinKey && closestPin.key !== activePinKey) {
                        isDraggingRef.current = false;
                        return;
                    }
                    draggedPinKeyRef.current = closestPin.key;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                } else {
                    isDraggingRef.current = false;
                }
            } catch {
                isDraggingRef.current = false;
            }
        },
        [activePinKey, pins, mapRef],
    );

    const handleDragUpdate = useCallback(
        (absoluteX: number, absoluteY: number) => {
            if (!isDraggingRef.current) return;
            updateDraftCoordinate(absoluteX, absoluteY);
        },
        [updateDraftCoordinate],
    );

    const handleDragEnd = useCallback(() => {
        if (
            isDraggingRef.current &&
            draftPinCoordinateRef.current &&
            draggedPinKeyRef.current &&
            questionId
        ) {
            onCommit(
                questionId,
                draggedPinKeyRef.current,
                draftPinCoordinateRef.current,
            );
        }
        cleanupDrag();
    }, [questionId, cleanupDrag, onCommit]);

    const handleDragFinalize = useCallback(() => {
        cleanupDrag();
    }, [cleanupDrag]);

    const gesture = useMemo(() => {
        return Gesture.Pan()
            .activateAfterLongPress(300)
            .enabled(canMove)
            .onStart((event: { absoluteX: number; absoluteY: number }) => {
                runOnJS(handleDragStart)(event.absoluteX, event.absoluteY);
            })
            .onUpdate((event: { absoluteX: number; absoluteY: number }) => {
                runOnJS(handleDragUpdate)(event.absoluteX, event.absoluteY);
            })
            .onEnd(() => {
                runOnJS(handleDragEnd)();
            })
            .onFinalize(() => {
                runOnJS(handleDragFinalize)();
            });
    }, [
        canMove,
        handleDragStart,
        handleDragUpdate,
        handleDragEnd,
        handleDragFinalize,
    ]);

    return {
        draftCoordinate,
        draggedPinKey: draggedPinKeyRef.current,
        dragHandlers: {
            handleDragEnd,
            handleDragFinalize,
            handleDragStart,
            handleDragUpdate,
        },
        gesture,
        isDragging,
        revision: tick,
    };
}
