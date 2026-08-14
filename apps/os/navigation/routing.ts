// navigation/routing — the single home for entity → detail-route knowledge (Phase 4.5, DC-4.5.4).
//
// PRESENTATION-LAYER helper, owned by neither Search nor Console: Search owns relevance, Console owns
// composition, and entity→route mapping lives HERE so both faces consume one copy (no duplication).
// Pure and deterministic: it maps an entity + id to a Next route string, or null when no detail route
// exists yet (rendered non-navigable — honest, never an invented route). It imports only TYPES
// (`EntityKind`, `SearchResult`); it reads no fs, computes no relevance, renders nothing.

import type { EntityKind } from "@/domain";
import type { SearchResult } from "@/packages/search";

/**
 * Map an entity + id to its existing detail route, or `null` if the entity has no detail route yet.
 * V1 routes only the entities with real destinations; everything else is non-navigable by design.
 */
export function routeForEntity(entity: EntityKind, id: string): string | null {
  switch (entity) {
    case "prospect":
      return `/sales/${id}`;
    case "client":
      return `/production/${id}`;
    // Additive (Neural Core): entities that gained nodes in the graph and already have a real
    // destination. Existing mappings above are unchanged, so Console behavior is untouched.
    case "project":
      return `/production/${id}`;
    case "document":
      return `/documents/${id}`;
    case "invoice":
      return "/finance";
    default:
      // phase · task · approval · audit · care_plan · sop have no detail route yet. Returning null
      // renders them non-navigable — honest, never an invented route (GAP-5).
      return null;
  }
}

/** Convenience over a search/navigation result: its detail route, or `null` if non-navigable. */
export function objectHref(result: Pick<SearchResult, "entity" | "id">): string | null {
  return routeForEntity(result.entity, result.id);
}
