"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GalaxyStageMount } from "@/components/galaxy/GalaxyStageMount";
import type { SystemMap } from "@/graph-view/field/systems";

export const GALAXY_AUTO_REFRESH_MS = 60_000;

// Re-reading belongs to the application seam. The renderer opens ordinary links and receives data.
export function GalaxyClient({ systemMap, initialFocusId }: { systemMap: SystemMap; initialFocusId: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastRefresh = useRef<number | null>(null);
  const refresh = useCallback(() => {
    lastRefresh.current = Date.now();
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    lastRefresh.current = Date.now();
    const refreshIfStale = () => {
      const previous = lastRefresh.current;
      if (!document.hidden && previous !== null && Date.now() - previous >= GALAXY_AUTO_REFRESH_MS) refresh();
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, GALAXY_AUTO_REFRESH_MS);
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [refresh]);

  return <GalaxyStageMount systemMap={systemMap} initialFocusId={initialFocusId} onRefresh={refresh} />;
}
