"use client";

import { useState } from "react";
import { EngineModalContext, type ModalConfig } from "./EngineModalContext";
import ConfigModal from "./ConfigModal";

export default function EnginePageShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ModalConfig>({});

  const openModal = (cfg: ModalConfig = {}) => {
    setConfig(cfg);
    setOpen(true);
  };

  return (
    <EngineModalContext.Provider value={{ openModal }}>
      {children}
      <ConfigModal open={open} config={config} onClose={() => setOpen(false)} />
    </EngineModalContext.Provider>
  );
}
