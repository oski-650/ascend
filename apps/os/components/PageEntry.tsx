"use client";

import { motion } from "framer-motion";

/**
 * Reusable spring-physics page entry wrapper.
 * Cascade-friendly — drop this around any page's root <div>.
 */
export function PageEntry({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
    >
      {children}
    </motion.div>
  );
}
