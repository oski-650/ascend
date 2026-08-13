import type { Client, Frontmatter, ProfileSection } from "./vault";

function fmtTable(data: Frontmatter): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "_(no metadata)_";
  const rows = entries.map(([k, v]) => `| **${k}** | ${stringifyValue(v)} |`);
  return ["| Field | Value |", "| --- | --- |", ...rows].join("\n");
}

function stringifyValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object" && v !== null) return "`" + JSON.stringify(v) + "`";
  return String(v).replace(/\n/g, " ");
}

function section(title: string, s: ProfileSection): string {
  if (s.missing) return `## ${title}\n\n_(file not yet created)_`;
  const meta = fmtTable(s.frontmatter);
  const body = s.body.length > 0 ? s.body : "_(no body content)_";
  return `## ${title}\n\n${meta}\n\n${body}`;
}

export function compileContext(client: Client): string {
  const timestamp = new Date().toISOString();
  const parts = [
    `# Active Client Context: ${client.name}`,
    "",
    `_Compiled by Ascend OS for use as a system context payload. Paste this at the top of a new Claude conversation, then ask your question._`,
    "",
    section("Business Context", client.business),
    "",
    section("Brand Identity", client.brand),
    "",
    section("Project Scope", client.scope),
    "",
    `## Structural Meta`,
    "",
    client.meta.missing ? "_(structural_meta.json not yet created)_" : fmtTable(client.meta.data),
    "",
    `<!-- Compiled by Ascend OS · vault: ${client.slug} · ${timestamp} -->`,
    "",
  ];
  return parts.join("\n");
}
