"use client";

import { motion } from "framer-motion";

// Spring-physics page entry wrapper. Adds a subtle fade+lift on first render.
export function DashboardEntry({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
    >
      {children}
    </motion.div>
  );
}
