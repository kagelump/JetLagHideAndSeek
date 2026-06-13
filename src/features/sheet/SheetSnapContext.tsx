import { createContext, useContext } from "react";

type SheetSnapContextValue = {
    snapToIndex: (index: number) => void;
};

const SheetSnapContext = createContext<SheetSnapContextValue | null>(null);

export function useSheetSnap(): SheetSnapContextValue {
    const ctx = useContext(SheetSnapContext);
    if (!ctx) {
        throw new Error(
            "useSheetSnap must be used within a SheetSnapProvider.",
        );
    }
    return ctx;
}

export function SheetSnapProvider({
    children,
    snapToIndex,
}: {
    children: React.ReactNode;
    snapToIndex: (index: number) => void;
}) {
    return (
        <SheetSnapContext.Provider value={{ snapToIndex }}>
            {children}
        </SheetSnapContext.Provider>
    );
}
