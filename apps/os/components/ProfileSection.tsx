import type { Frontmatter, ProfileSection as ProfileSectionData } from "@/lib/vault";
import { renderMarkdown } from "@/lib/renderMarkdown";


function renderMetaRows(fm: Frontmatter) {
  const entries = Object.entries(fm).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-[var(--color-border-hi)] pb-4 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{k}</dt>
          <dd className="text-sm text-[var(--color-fg)]">{stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function stringify(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

export function ProfileSection({ title, section }: { title: string; section: ProfileSectionData }) {
  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-fg-mute)]">
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
        {title}
      </h2>
      {section.missing ? (
        <p className="font-mono text-xs text-[var(--color-fg-dim)]">file not yet created</p>
      ) : (
        <>
          {renderMetaRows(section.frontmatter)}
          {section.body && (
            <article
              className="prose-invert mt-4 max-w-none text-sm leading-relaxed text-[var(--color-fg)] [&_a]:text-[var(--color-accent)] [&_code]:rounded [&_code]:bg-[var(--color-surface-hi)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
            />
          )}
        </>
      )}
    </section>
  );
}

export function MetaSection({ data, missing }: { data: Frontmatter; missing: boolean }) {
  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-fg-mute)]">
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
        Structural Meta
      </h2>
      {missing ? (
        <p className="font-mono text-xs text-[var(--color-fg-dim)]">structural_meta.json not yet created</p>
      ) : (
        renderMetaRows(data) ?? <p className="font-mono text-xs text-[var(--color-fg-dim)]">(empty)</p>
      )}
    </section>
  );
}
