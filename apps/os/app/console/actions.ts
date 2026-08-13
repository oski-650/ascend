"use server";

// The mutation CONFIRM transport (DC-5x.4): a POST-only Server Action. Reads/navigation stay on GET;
// a state change can only be triggered by this POST. The action owns NO mutation logic — it forwards
// the explicit confirm to core/command-runtime.runCommand, which dispatches to the capability handler,
// which delegates to the existing core write API. Post-Redirect-Get: after the write it redirects back
// to /console with a compact outcome, so a refresh never re-submits the write.

import { redirect } from "next/navigation";
import { runCommand } from "@/core/command-runtime";

export async function confirmMutation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const argName = String(formData.get("argName") ?? "");
  const argValue = String(formData.get("arg") ?? "");
  const q = String(formData.get("q") ?? "");

  const args = argName ? { [argName]: argValue } : {};
  const result = await runCommand(id, args, { confirm: true }); // the ONLY confirmed call path

  const outcome = result.ok
    ? (result.data && (result.data as { changed?: boolean }).changed ? "applied" : "noop")
    : "error";

  const params = new URLSearchParams({ q, prev: id, arg: argValue, outcome });
  redirect(`/console?${params.toString()}`);
}