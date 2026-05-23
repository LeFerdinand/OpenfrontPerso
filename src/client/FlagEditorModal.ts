/**
 * FlagEditorModal — pixel-art editor for player-drawn flags.
 *
 * Output: a 48x17 PNG encoded as a `custom:data:image/png;base64,...` flag
 * ref persisted via UserSettings.setFlag. The ref travels with the player
 * over the wire so other clients see the same drawing.
 */
import { html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserSettings } from "src/core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import { translateText } from "./Utils";

const GRID_W = 32;
const GRID_H = 24;
/** Pixel size of one grid cell in the editor viewport. */
const CELL_PX = 14;

type Tool = "pencil" | "fill" | "eraser";

const PALETTE: ReadonlyArray<string> = [
  "#000000", "#ffffff", "#808080", "#c0c0c0",
  "#ff0000", "#b40000", "#ff6a00", "#ffd400",
  "#ffff00", "#00b050", "#006400", "#00d4ff",
  "#0070ff", "#001f7d", "#7b3aff", "#ff5fa2",
  "#8b4513", "#f5deb3",
];

@customElement("flag-editor-modal")
export class FlagEditorModal extends BaseModal {
  protected routerName = "flag-editor";

  @state() private color = "#ff0000";
  @state() private tool: Tool = "pencil";
  /**
   * Flat 48*17 array of CSS color strings (or empty string for transparent).
   * Kept in render order: index = row*GRID_W + col.
   */
  @state() private pixels: string[] = new Array(GRID_W * GRID_H).fill("");

  @query("#flag-canvas") private canvasEl?: HTMLCanvasElement;

  private painting = false;

  protected modalConfig() {
    return {
      title: translateText("flag_editor.title"),
      maxWidth: "780px",
    };
  }

  protected onOpen(): void {
    // Always start from a blank canvas. The user can save+reopen to iterate
    // on the same design via UserSettings.getFlag if we later wire it in.
    this.pixels = new Array(GRID_W * GRID_H).fill("");
    this.tool = "pencil";
    this.color = "#ff0000";
    this.requestUpdate();
    // Defer the paint until the canvas element is in the DOM.
    queueMicrotask(() => this.repaint());
  }

  protected renderBody(): TemplateResult {
    const cw = GRID_W * CELL_PX;
    const ch = GRID_H * CELL_PX;
    return html`
      <div class="flex flex-col gap-3 p-4 text-white">
        <div class="flex gap-2 flex-wrap items-center">
          ${this.renderToolButton("pencil", translateText("flag_editor.pencil"))}
          ${this.renderToolButton("fill", translateText("flag_editor.fill"))}
          ${this.renderToolButton("eraser", translateText("flag_editor.eraser"))}
          <button
            class="px-3 py-1.5 rounded bg-red-700/70 hover:bg-red-700 text-sm font-semibold"
            @click=${this.clearAll}
          >${translateText("flag_editor.clear")}</button>
        </div>

        <div class="flex gap-1 flex-wrap items-center">
          ${PALETTE.map(
            (c) => html`
              <button
                title=${c}
                class=${`w-7 h-7 rounded border-2 ${
                  this.color === c ? "border-white" : "border-black/40"
                }`}
                style=${`background:${c}`}
                @click=${() => (this.color = c)}
              ></button>
            `,
          )}
          <input
            type="color"
            .value=${this.color}
            class="w-9 h-9 rounded cursor-pointer bg-transparent"
            title=${translateText("flag_editor.custom_color")}
            @input=${(e: InputEvent) =>
              (this.color = (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="flex justify-center">
          <canvas
            id="flag-canvas"
            width=${cw}
            height=${ch}
            class="border-2 border-white/30 bg-neutral-800 cursor-crosshair touch-none"
            style=${`image-rendering:pixelated;width:${cw}px;height:${ch}px;`}
            @pointerdown=${this.onPointerDown}
            @pointermove=${this.onPointerMove}
            @pointerup=${this.endStroke}
            @pointerleave=${this.endStroke}
            @pointercancel=${this.endStroke}
          ></canvas>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            class="px-4 py-2 rounded bg-neutral-600 hover:bg-neutral-500 font-semibold"
            @click=${() => this.close()}
          >${translateText("flag_editor.cancel")}</button>
          <button
            class="px-4 py-2 rounded bg-green-600 hover:bg-green-500 font-semibold"
            @click=${this.save}
          >${translateText("flag_editor.save")}</button>
        </div>
      </div>
    `;
  }

  private renderToolButton(t: Tool, label: string): TemplateResult {
    const active = this.tool === t;
    return html`
      <button
        class=${`px-3 py-1.5 rounded text-sm font-semibold ${
          active ? "bg-blue-600" : "bg-neutral-700 hover:bg-neutral-600"
        }`}
        @click=${() => (this.tool = t)}
      >${label}</button>
    `;
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  private cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    if (!this.canvasEl) return null;
    const rect = this.canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor((x / rect.width) * GRID_W);
    const row = Math.floor((y / rect.height) * GRID_H);
    if (col < 0 || col >= GRID_W || row < 0 || row >= GRID_H) return null;
    return { col, row };
  }

  private onPointerDown = (e: PointerEvent) => {
    const c = this.cellFromEvent(e);
    if (!c) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    this.painting = true;
    if (this.tool === "fill") {
      this.floodFill(c.col, c.row);
    } else {
      this.paintCell(c.col, c.row);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.painting || this.tool === "fill") return;
    const c = this.cellFromEvent(e);
    if (!c) return;
    this.paintCell(c.col, c.row);
  };

  private endStroke = () => {
    this.painting = false;
  };

  private paintCell(col: number, row: number): void {
    const idx = row * GRID_W + col;
    const next = this.tool === "eraser" ? "" : this.color;
    if (this.pixels[idx] === next) return;
    // Mutate in place to keep state.changes cheap; trigger a redraw manually.
    this.pixels[idx] = next;
    this.repaintCell(col, row);
  }

  /** BFS bucket fill — replaces every same-colored cell in the 4-connected region. */
  private floodFill(col: number, row: number): void {
    const target = this.pixels[row * GRID_W + col];
    const replacement = this.tool === "eraser" ? "" : this.color;
    if (target === replacement) return;
    const stack: [number, number][] = [[col, row]];
    while (stack.length) {
      const [c, r] = stack.pop()!;
      if (c < 0 || c >= GRID_W || r < 0 || r >= GRID_H) continue;
      const idx = r * GRID_W + c;
      if (this.pixels[idx] !== target) continue;
      this.pixels[idx] = replacement;
      stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    this.repaint();
  }

  private clearAll = () => {
    this.pixels = new Array(GRID_W * GRID_H).fill("");
    this.repaint();
  };

  /** Redraw the full editor canvas from `pixels[]`. */
  private repaint(): void {
    const cv = this.canvasEl;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Subtle checkerboard background to show transparency.
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#111827";
    for (let r = 0; r < GRID_H; r++) {
      for (let c = 0; c < GRID_W; c++) {
        if ((r + c) % 2 === 0) {
          ctx.fillRect(c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
        }
      }
    }
    // Paint cells.
    for (let r = 0; r < GRID_H; r++) {
      for (let c = 0; c < GRID_W; c++) {
        const color = this.pixels[r * GRID_W + c];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  /** Cheap single-cell repaint used during a brush stroke. */
  private repaintCell(col: number, row: number): void {
    const cv = this.canvasEl;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const x = col * CELL_PX;
    const y = row * CELL_PX;
    // Restore checkerboard under the cell first.
    ctx.fillStyle = (col + row) % 2 === 0 ? "#111827" : "#1f2937";
    ctx.fillRect(x, y, CELL_PX, CELL_PX);
    const color = this.pixels[row * GRID_W + col];
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────

  /** Render the design to a 48x17 PNG and persist via UserSettings. */
  private save = () => {
    const out = document.createElement("canvas");
    out.width = GRID_W;
    out.height = GRID_H;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    for (let r = 0; r < GRID_H; r++) {
      for (let c = 0; c < GRID_W; c++) {
        const color = this.pixels[r * GRID_W + c];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(c, r, 1, 1);
      }
    }
    const dataUrl = out.toDataURL("image/png");
    new UserSettings().setFlag(`custom:${dataUrl}`);
    this.close();
  };
}
