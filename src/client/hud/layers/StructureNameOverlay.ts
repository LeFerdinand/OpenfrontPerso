/**
 * StructureNameOverlay — DOM-based labels rendered above named structures.
 *
 * The label set is sparse (only structures the player has explicitly
 * renamed), so a plain DOM overlay with one div per name is more
 * straightforward than adding a WebGL pass + MSDF text. The container is
 * positioned exactly like AttackingTroopsOverlay so labels track the camera
 * during pan + zoom.
 */

import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { Structures } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UnitView } from "../../view/UnitView";
import { Controller } from "../../Controller";
import { AlternateViewEvent } from "../../InputHandler";
import type { StructureNameStore } from "../../StructureNameStore";
import { TransformHandler } from "../../TransformHandler";
import { computeLabelScale } from "./AttackingTroopsOverlay";

interface NameLabel {
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  unit: UnitView;
  /** Last rendered name — repaint inner only when this changes. */
  lastText: string;
}

export class StructureNameOverlay implements Controller {
  private container: HTMLDivElement | null = null;
  private labels = new Map<number, NameLabel>();
  private unsubscribe: (() => void) | null = null;
  private onAlternateView: ((e: AlternateViewEvent) => void) | null = null;
  private isVisible = true;
  /** RAF handle so we can cancel on destroy. */
  private rafHandle: number | null = null;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
    private readonly eventBus: EventBus,
    private readonly store: StructureNameStore,
  ) {}

  init(): void {
    this.container = document.createElement("div");
    const c = this.container;
    c.style.position = "fixed";
    c.style.left = "50%";
    c.style.top = "50%";
    c.style.pointerEvents = "none";
    // Above NameLayer (z=3) and AttackingTroopsOverlay (z=4) so a renamed
    // structure label is always readable.
    c.style.zIndex = "5";
    document.body.appendChild(c);

    this.unsubscribe = this.store.subscribe(() => this.syncLabels());

    this.onAlternateView = (e) => {
      this.isVisible = !e.alternateView;
      c.style.display = this.isVisible ? "" : "none";
    };
    this.eventBus.on(AlternateViewEvent, this.onAlternateView);

    const drive = () => {
      this.updateLabelDOM();
      this.rafHandle = requestAnimationFrame(drive);
    };
    this.rafHandle = requestAnimationFrame(drive);
  }

  destroy(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.unsubscribe?.();
    if (this.onAlternateView) {
      this.eventBus.off(AlternateViewEvent, this.onAlternateView);
    }
    for (const lbl of this.labels.values()) lbl.outer.remove();
    this.labels.clear();
    this.container?.remove();
    this.container = null;
  }

  getTickIntervalMs(): number {
    return 500;
  }

  /** Sync label DOM with the store's keys (called on tick + on store change). */
  tick(): void {
    this.syncLabels();
  }

  private syncLabels(): void {
    if (!this.container) return;
    // Index all active structure units once.
    const byId = new Map<number, UnitView>();
    for (const u of this.game.units(...Structures.types)) {
      byId.set(u.id(), u);
    }

    // Remove labels for unit IDs that are no longer named or no longer alive.
    for (const [id, lbl] of this.labels) {
      const stillNamed = this.store.get(id) !== undefined;
      const stillAlive = byId.has(id);
      if (!stillNamed || !stillAlive) {
        lbl.outer.remove();
        this.labels.delete(id);
      }
    }

    // Create labels for newly named structures.
    // We iterate the store's known IDs via a probe over byId — the store
    // is small, so this is cheap.
    for (const [id, unit] of byId) {
      const name = this.store.get(id);
      if (name === undefined) continue;
      const existing = this.labels.get(id);
      if (existing) {
        if (existing.lastText !== name) {
          existing.inner.textContent = name;
          existing.lastText = name;
        }
        // The UnitView reference is stable for the unit's lifetime,
        // but capture it again in case the previous one was stale.
        existing.unit = unit;
      } else {
        const { outer, inner } = this.createLabelElement(name);
        this.container.appendChild(outer);
        this.labels.set(id, {
          outer,
          inner,
          unit,
          lastText: name,
        });
      }
    }
  }

  private updateLabelDOM(): void {
    if (!this.container || this.labels.size === 0) return;

    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    );
    const offsetX = screenPos.x - window.innerWidth / 2;
    const offsetY = screenPos.y - window.innerHeight / 2;
    this.container.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.transformHandler.scale})`;

    const scale = computeLabelScale(this.transformHandler.scale);
    // Keep the centering translates in the transform — overwriting with just
    // `scale()` would drop them and the label would jump up-left of the tile.
    const innerTransform = `translate(-50%, -100%) scale(${scale})`;

    for (const lbl of this.labels.values()) {
      const tile = lbl.unit.tile();
      const cellX = this.game.x(tile);
      const cellY = this.game.y(tile);
      const cell = new Cell(cellX, cellY);
      if (!this.transformHandler.isOnScreen(cell)) {
        lbl.outer.style.display = "none";
        continue;
      }
      lbl.outer.style.display = "";
      // Anchor the outer exactly on the structure tile center.
      lbl.outer.style.transform = `translate(${cellX}px, ${cellY}px)`;
      lbl.inner.style.transform = innerTransform;
    }
  }

  private createLabelElement(text: string): {
    outer: HTMLDivElement;
    inner: HTMLDivElement;
  } {
    const outer = document.createElement("div");
    outer.style.position = "absolute";
    outer.style.display = "none";
    outer.style.pointerEvents = "none";
    outer.style.willChange = "transform";

    const inner = document.createElement("div");
    inner.textContent = text;
    inner.style.position = "absolute";
    // (0,0) is the structure tile center (set on outer). The label hangs
    // above it: `translate(-50%, -100%)` (applied each frame in
    // updateLabelDOM) shifts it left by half its width and up by its full
    // height, and the -10px nudge here lifts it clear of the sprite.
    inner.style.left = "0";
    inner.style.top = "-10px";
    inner.style.transformOrigin = "50% 100%";
    inner.style.fontFamily = "system-ui, sans-serif";
    inner.style.fontWeight = "700";
    inner.style.fontSize = "14px";
    inner.style.lineHeight = "1";
    inner.style.color = "#ffffff";
    inner.style.whiteSpace = "nowrap";
    inner.style.userSelect = "none";
    // Black outline using a 4-direction text-shadow stack — works in
    // every browser without depending on -webkit-text-stroke.
    inner.style.textShadow = [
      "-1px -1px 0 #000",
      "1px -1px 0 #000",
      "-1px 1px 0 #000",
      "1px 1px 0 #000",
      "0 0 3px rgba(0,0,0,0.6)",
    ].join(", ");

    outer.appendChild(inner);
    return { outer, inner };
  }
}
