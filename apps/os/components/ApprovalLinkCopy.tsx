"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";

export function ApprovalLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }
  return (
    <Button type="button" onClick={copy} variant="ghost" title={url}>
      {copied ? "Copied ✓" : "Copy link"}
    </Button>
  );
}
