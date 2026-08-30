// FIXTURE · the same shape written correctly. The matcher must NOT flag this.
//
// It reaches data, and if the data boundary refuses, it renders the denial surface. It never asks
// whether it is allowed — that question is answered where the data lives.
import { renderOrDenied } from "@/components/auth/renderOrDenied";

async function CopesWithDenialContent() {
  return <p>the real view</p>;
}

export default async function CopesWithDenial(...props: Parameters<typeof CopesWithDenialContent>) {
  return renderOrDenied("Fixture", () => CopesWithDenialContent(...props));
}
