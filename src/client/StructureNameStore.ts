/**
 * Session-scoped custom names for structures.
 *
 * Names live in-memory only — unit IDs are unique per game session, so we
 * don't bother persisting beyond the page lifetime. The store is shared by:
 *   • MainRadialMenu / ClientGameRunner (writes a name on click of a structure)
 *   • StructureNameOverlay (reads names every frame for label placement)
 *
 * Exported as both a class (for explicit DI in MainRadialMenu/Overlay) and a
 * module-level singleton (used by ClientGameRunner, which sits outside the
 * Controller graph).
 */
export class StructureNameStore {
  private names = new Map<number, string>();
  private listeners = new Set<() => void>();

  get(unitId: number): string | undefined {
    return this.names.get(unitId);
  }

  /** Trim and store; empty string clears the entry. */
  set(unitId: number, name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") this.names.delete(unitId);
    else this.names.set(unitId, trimmed);
    for (const l of this.listeners) l();
  }

  size(): number {
    return this.names.size;
  }

  /** Fired whenever any name changes — overlay uses this to recreate DOM nodes. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * Single page-lifetime instance shared across all entry points. A class is
 * still exported so a future test could instantiate its own isolated store.
 */
export const structureNameStore = new StructureNameStore();
