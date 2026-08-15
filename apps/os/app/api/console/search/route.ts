// app/api/console/search — read-only search backing the ⌘K palette.
//
// It introduces NO new search architecture. It is a thin transport over the two deterministic
// matchers that already own this behavior:
//   • objects  → core/knowledge.buildKnowledgeIndex() → packages/search.query()
//   • commands → core/command-runtime.listCommands()  → packages/commands.matchCommands()
// Entity → route resolution stays with navigation/routing, the single owner.
//
// GET is READ-ONLY and never executes a command: it returns metadata only. Mutations continue to
// run through the existing preview → explicit POST confirm gate in core/command-runtime. This route
// is protected by the deny-by-default perimeter in middleware.ts.

import { NextResponse, type NextRequest } from "next/server";
import { buildKnowledgeIndex } from "@/core/knowledge";
import { query } from "@/packages/search";
import { matchCommands } from "@/packages/commands";
import { listCommands } from "@/core/command-runtime";
import { objectHref } from "@/navigation/routing";
import { focusHrefFor } from "@/graph-view/contract";

export const dynamic = "force-dynamic";

const LIMIT = 8;

export async function GET(request: NextRequest) {
  const term = (request.nextUrl.searchParams.get("q") ?? "").trim();

  if (term.length === 0) {
    return NextResponse.json({ objects: [], commands: [] });
  }

  try {
    const index = await buildKnowledgeIndex();

    const objects = query(index.search, term)
      .slice(0, LIMIT)
      .map((result) => ({
        id: result.id,
        entity: result.entity,
        title: result.title,
        href: objectHref(result),
        // Both destinations are resolved HERE, by the two canonical owners: navigation/routing for
        // the detail route, the graph contract for graph identity. The palette receives finished
        // hrefs and constructs neither, so no second routing table or graph model exists on the
        // client. `null` where the entity has no detail route / cannot be a node.
        focusHref: focusHrefFor(result.entity, result.id),
      }));

    const commands = matchCommands(listCommands(), term)
      .slice(0, LIMIT)
      .map(({ metadata }) => ({
        id: metadata.id,
        label: metadata.label,
        description: metadata.description,
        kind: metadata.kind,
      }));

    return NextResponse.json({ objects, commands });
  } catch {
    // A missing/unreadable vault must not surface a stack trace to the client.
    return NextResponse.json({ objects: [], commands: [], error: "Search unavailable" }, { status: 200 });
  }
}