import { createContext, type ReactNode, useContext } from "react";

// ---------------------------------------------------------------------------
// Shared label-language context
//
// Breaking the module-level import cycle between questionStore and
// hidingZoneStore. The labelLanguage state lives here; QuestionProvider owns
// it and feeds it in via LabelLanguageProvider. HidingZoneProvider reads it
// from this module instead of reaching into questionStore.
// ---------------------------------------------------------------------------

const LabelLanguageContext = createContext<"native" | "english">("native");

/**
 * Provider that makes labelLanguage available to descendants.
 * Rendered by QuestionProvider with its current state value.
 */
export function LabelLanguageProvider({
    value,
    children,
}: {
    value: "native" | "english";
    children: ReactNode;
}) {
    return (
        <LabelLanguageContext.Provider value={value}>
            {children}
        </LabelLanguageContext.Provider>
    );
}

/**
 * Returns the current label language preference.
 * Defaults to "native" when no provider is in the tree.
 */
export function useLabelLanguage(): "native" | "english" {
    return useContext(LabelLanguageContext);
}
