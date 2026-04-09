"use client";

import { createContext, useContext } from "react";

export interface ModalConfig {
  /** Display label shown in the modal header, e.g. "HVAC & PLUMBING" */
  preset?: string;
}

interface EngineModalContextValue {
  openModal: (config?: ModalConfig) => void;
}

export const EngineModalContext = createContext<EngineModalContextValue>({
  openModal: () => {},
});

export function useEngineModal() {
  return useContext(EngineModalContext);
}
