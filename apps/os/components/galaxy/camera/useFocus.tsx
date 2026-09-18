"use client";

// components/galaxy/camera/useFocus — binding the focus store to React, and to nothing else.
//
// The store itself (`focusStore.ts`) is framework-free and per-mount. This file is the only bridge
// between it and the component tree, and it is deliberately thin: a provider, a selector hook, and
// an escape hatch that hands out the raw store for code that must subscribe OUTSIDE the render loop.
//
// ─── THE ESCAPE HATCH IS THE POINT, NOT A COMPROMISE ───────────────────────────────────────────
//
// `useFocusStore()` returns the store API rather than a value. The camera rig uses it to
// `.subscribe()` and to read `.getState()` inside `useFrame`, so camera motion causes ZERO React
// renders. §16.2 names "driving any per-frame value through React state" as the second most likely
// way to wreck this, and a hook that only ever returns values would leave no way to avoid it.
//
// `useFocus(selector)` is for the HUD — a breadcrumb and a panel legitimately re-render when the
// focus changes, which happens a handful of times a minute rather than sixty times a second.

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createFocusStore, type FocusActions, type FocusState, type FocusStore } from "./focusStore";

const FocusContext = createContext<FocusStore | null>(null);

export function FocusProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<FocusState>;
}) {
  // One store per mount, created once. `useRef` rather than `useState` because nothing re-renders
  // when it is created and nothing ever replaces it — the store's own subscribers handle change.
  const store = useRef<FocusStore | null>(null);
  store.current ??= createFocusStore(initial);
  return <FocusContext.Provider value={store.current}>{children}</FocusContext.Provider>;
}

/**
 * The raw store, for subscribing outside React render. Throws rather than returning null: a camera
 * rig that silently got no store would simply never move, which is the hardest class of bug to see.
 */
export function useFocusStore(): FocusStore {
  const store = useContext(FocusContext);
  if (store === null) throw new Error("useFocusStore must be used inside <FocusProvider>");
  return store;
}

/** A selected slice of focus state, for HUD components that should re-render when it changes. */
export function useFocus<T>(selector: (state: FocusState & FocusActions) => T): T {
  return useStore(useFocusStore(), selector);
}
