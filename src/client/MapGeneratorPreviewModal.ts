/**
 * MapGeneratorPreviewModal — internal tool to iterate on procedural map
 * generation visually before wiring it into the game.
 *
 * Renders the generator's raw byte array to a 2D canvas using a small
 * terrain color ramp. Buttons let us regenerate with a new random seed,
 * pick a style, and pick a size — without going through the lobby flow
 * or rebuilding the game runner.
 */

import { html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  generateMap,
  type GeneratedMap,
  type MapSize,
  type MapStyle,
} from "src/core/game/MapGenerator";
import { buildTerrainRGBA } from "./render/gl/utils/ColorUtils";
import { BaseModal } from "./components/BaseModal";

const STYLES: ReadonlyArray<MapStyle> = ["continental", "archipelago", "mixed"];
const SIZES: ReadonlyArray<MapSize> = ["small", "medium", "large"];

@customElement("map-generator-preview-modal")
export class MapGeneratorPreviewModal extends BaseModal {
  protected routerName = "map-generator-preview";

  @state() private seed = randomSeed();
  @state() private mapStyle: MapStyle = "continental";
  @state() private size: MapSize = "small";
  @state() private busy = false;
  @state() private lastStats: {
    landPct: number;
    nationCount: number;
    elapsedMs: number;
  } | null = null;

  @query("#map-preview-canvas") private canvas?: HTMLCanvasElement;

  protected modalConfig() {
    return { title: "Aperçu carte aléatoire", maxWidth: "1100px" };
  }

  protected onOpen(): void {
    // Defer until the canvas is mounted.
    queueMicrotask(() => this.regenerate(false));
  }

  protected renderBody(): TemplateResult {
    return html`
      <div class="flex flex-col gap-3 p-4 text-white">
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-1 text-sm">
            Style
            <select
              class="bg-neutral-800 rounded px-2 py-1"
              .value=${this.mapStyle}
              @change=${(e: Event) => {
                this.mapStyle = (e.target as HTMLSelectElement).value as MapStyle;
                this.regenerate(false);
              }}
            >
              ${STYLES.map(
                (s) => html`<option value=${s}>${s}</option>`,
              )}
            </select>
          </label>
          <label class="flex items-center gap-1 text-sm">
            Taille
            <select
              class="bg-neutral-800 rounded px-2 py-1"
              .value=${this.size}
              @change=${(e: Event) => {
                this.size = (e.target as HTMLSelectElement).value as MapSize;
                this.regenerate(false);
              }}
            >
              ${SIZES.map((s) => html`<option value=${s}>${s}</option>`)}
            </select>
          </label>
          <label class="flex items-center gap-1 text-sm">
            Seed
            <input
              class="bg-neutral-800 rounded px-2 py-1 w-40 font-mono text-xs"
              .value=${this.seed}
              @change=${(e: Event) => {
                this.seed = (e.target as HTMLInputElement).value;
                this.regenerate(false);
              }}
            />
          </label>
          <button
            class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-semibold disabled:opacity-50"
            ?disabled=${this.busy}
            @click=${() => this.regenerate(true)}
          >
            ${this.busy ? "…" : "🎲 Nouvelle seed"}
          </button>
          ${this.lastStats
            ? html`<span class="text-xs text-white/70 ml-auto"
                >land ${this.lastStats.landPct.toFixed(1)}% · ${this.lastStats
                  .nationCount} nations · ${this.lastStats.elapsedMs} ms</span
              >`
            : null}
        </div>

        <div class="flex justify-center bg-neutral-900 rounded p-2">
          <canvas
            id="map-preview-canvas"
            class="max-w-full"
            style="image-rendering:pixelated;"
          ></canvas>
        </div>

        <div class="flex flex-wrap gap-3 text-xs text-white/70">
          <span><span class="inline-block w-3 h-3 align-middle bg-[#4684b8]"></span> océan profond</span>
          <span><span class="inline-block w-3 h-3 align-middle bg-[#648fff]"></span> côte (mer)</span>
          <span><span class="inline-block w-3 h-3 align-middle bg-[#cccb9e]"></span> côte (terre)</span>
          <span><span class="inline-block w-3 h-3 align-middle bg-[#bedc8a]"></span> plaine</span>
          <span><span class="inline-block w-3 h-3 align-middle bg-[#e6d5a8]"></span> colline</span>
          <span><span class="inline-block w-3 h-3 align-middle bg-[#f5f5f5]"></span> montagne</span>
          <span class="ml-auto">⛳ = spawn nation</span>
        </div>
      </div>
    `;
  }

  private regenerate(newSeed: boolean): void {
    if (newSeed) this.seed = randomSeed();
    this.busy = true;
    this.requestUpdate();

    // Yield to the UI thread so the busy indicator paints first; big maps
    // can stall for several hundred ms.
    requestAnimationFrame(() => {
      const t0 = performance.now();
      let result: GeneratedMap;
      try {
        result = generateMap({
          seed: this.seed,
          style: this.mapStyle,
          size: this.size,
        });
      } finally {
        this.busy = false;
      }
      const elapsedMs = Math.round(performance.now() - t0);
      this.lastStats = {
        landPct: (result.numLandTiles / (result.width * result.height)) * 100,
        nationCount: result.nations.length,
        elapsedMs,
      };
      this.paint(result);
    });
  }

  private paint(map: GeneratedMap): void {
    const cv = this.canvas;
    if (!cv) return;
    cv.width = map.width;
    cv.height = map.height;
    // Display width capped at 1000 css px so very large maps stay readable.
    const cssW = Math.min(1000, map.width);
    cv.style.width = `${cssW}px`;
    cv.style.height = `${(cssW * map.height) / map.width}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // Reuse the in-game palette so the preview matches what the player will
    // see during a real game (flat tiers: sand / plains / highland /
    // mountain, with shoreline + deep-water bands for the sea).
    const rgba = buildTerrainRGBA(map.bin, map.width, map.height);
    const img = ctx.createImageData(map.width, map.height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);

    // Overlay nation spawns.
    ctx.fillStyle = "rgba(255, 255, 0, 0.9)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 1;
    for (const n of map.nations) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(3, map.width / 200), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}
