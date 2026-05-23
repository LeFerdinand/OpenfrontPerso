import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  Difficulty,
  GameMapType,
  mapCategories,
} from "../../../core/game/Game";
import type { LobbyTemplate } from "../../LobbyTemplates";
import { translateText } from "../../Utils";
import "./MapDisplay";
const randomMap = assetUrl("images/RandomMap.webp");

/** Pseudo-categories rendered above the regular map grid. Each entry maps
 *  a GameMapType.Random* value to its display label and a CSS gradient
 *  preview (no on-disk thumbnail exists for procedural maps). */
const RANDOM_MAP_CARDS: ReadonlyArray<{
  type: GameMapType;
  labelKey: string;
  gradient: string;
}> = [
  {
    type: GameMapType.RandomContinental,
    labelKey: "map.randomcontinental",
    gradient: "linear-gradient(135deg,#264b73 0%,#5fa14a 60%,#cccb9e 100%)",
  },
  {
    type: GameMapType.RandomArchipelago,
    labelKey: "map.randomarchipelago",
    gradient:
      "radial-gradient(circle at 25% 30%,#cccb9e 0 8%,#1e6f9f 8% 100%),radial-gradient(circle at 70% 60%,#cccb9e 0 7%,transparent 7% 100%),linear-gradient(135deg,#264b73,#1e6f9f)",
  },
  {
    type: GameMapType.RandomMixed,
    labelKey: "map.randommixed",
    gradient:
      "radial-gradient(ellipse at 30% 50%,#5fa14a 0 18%,#cccb9e 18% 22%,transparent 22% 100%),radial-gradient(circle at 80% 30%,#cccb9e 0 6%,transparent 6% 100%),linear-gradient(135deg,#264b73,#1e6f9f)",
  },
];

@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;
  /**
   * When provided, an extra "Mes modèles" tab is rendered next to the
   * map list. Templates are managed by the parent (host-lobby modal) —
   * the picker only dispatches user interactions back through the
   * callbacks.
   */
  @property({ attribute: false }) templates?: LobbyTemplate[];
  /**
   * Called when the user types a name and confirms. The new template
   * is saved with whatever map / options are currently selected on the
   * host modal — no extra map override here (the user can pick any
   * specific map or random directly from the maps grid that's also
   * shown in this tab).
   */
  @property({ attribute: false }) onSaveTemplate?: (name: string) => void;
  @property({ attribute: false }) onApplyTemplate?: (id: string) => void;
  @property({ attribute: false }) onDeleteTemplate?: (id: string) => void;

  @state() private activeTab: "maps" | "templates" = "maps";
  /** Inline "new template" name input — visible while naming. */
  @state() private creating = false;
  @state() private draftName: string = "";

  createRenderRoot() {
    return this;
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
  };

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private hasTemplatesTab(): boolean {
    return this.onSaveTemplate !== undefined;
  }

  private renderMapCard(mapValue: GameMapType) {
    const mapKey = Object.entries(GameMapType).find(
      ([_, value]) => value === mapValue,
    )?.[0];
    return html`
      <div
        @click=${() => this.handleMapSelection(mapValue)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${mapKey}
          .selected=${!this.useRandomMap && this.selectedMap === mapValue}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(mapValue)}
          .translation=${translateText(`map.${mapKey?.toLowerCase()}`)}
        ></map-display>
      </div>
    `;
  }

  private renderAllMaps() {
    const mapCategoryEntries = Object.entries(mapCategories);
    return html`<div class="space-y-8">
      ${this.renderRandomMapsSection()}
      ${mapCategoryEntries.map(
        ([categoryKey, maps]) => html`
          <div class="w-full">
            <h4
              class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
            >
              ${translateText(`map_categories.${categoryKey}`)}
            </h4>
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              ${maps.map((mapValue) => this.renderMapCard(mapValue))}
            </div>
          </div>
        `,
      )}
    </div>`;
  }

  /** Top section: 3 procedural-map cards rendered with CSS gradients so we
   *  don't need a baked thumbnail. Click → `onSelectMap` with the Random*
   *  GameMapType; the lobby modal then generates a fresh seed at start. */
  private renderRandomMapsSection() {
    return html`
      <div class="w-full">
        <h4
          class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
        >
          ${translateText("map_categories.random")}
        </h4>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          ${RANDOM_MAP_CARDS.map((card) => this.renderRandomCard(card))}
        </div>
      </div>
    `;
  }

  private renderRandomCard(card: (typeof RANDOM_MAP_CARDS)[number]) {
    const selected =
      !this.useRandomMap && this.selectedMap === card.type;
    return html`
      <div
        role="button"
        tabindex="0"
        @click=${() => this.handleMapSelection(card.type)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.handleMapSelection(card.type);
          }
        }}
        class="cursor-pointer w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border transition-all duration-200 active:scale-95 gap-3 group ${selected
          ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
      >
        <div
          class="w-full aspect-[2/1] rounded-lg overflow-hidden flex items-center justify-center text-white/80 text-xs font-bold uppercase tracking-wider"
          style=${`background:${card.gradient};`}
        >
          🎲
        </div>
        <div
          class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
        >
          ${translateText(card.labelKey)}
        </div>
      </div>
    `;
  }

  private renderTemplatesTab() {
    const templates = this.templates ?? [];
    return html`
      <div class="w-full space-y-8">
        <div>
          <h4
            class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
          >
            ${translateText("map.templates")}
          </h4>
          <div
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-stretch"
          >
            ${this.creating ? this.renderNameInput() : this.renderAddButton()}
            ${templates.map((t) => this.renderTemplateCard(t))}
          </div>
          ${templates.length === 0 && !this.creating
            ? html`<p
                class="mt-6 text-xs text-white/40 text-center italic px-4"
              >
                ${translateText("map.templates_empty")}
              </p>`
            : nothing}
        </div>
        <!-- All maps below, so the user can pick a specific map for the
             template they're about to create without leaving this tab. -->
        ${this.renderAllMaps()}
      </div>
    `;
  }

  private renderAddButton() {
    return html`
      <button
        type="button"
        class="w-full aspect-[2/1] flex items-center justify-center rounded-xl border-2 border-dashed border-white/20 hover:border-malibu-blue hover:bg-malibu-blue/10 text-white/70 hover:text-white transition-all duration-200 active:scale-95"
        @click=${this.beginCreate}
        title=${translateText("map.add_template")}
      >
        <div class="flex flex-col items-center gap-1">
          <span class="text-3xl leading-none">+</span>
          <span
            class="text-[10px] font-bold uppercase tracking-wider px-2 text-center"
            >${translateText("map.add_template")}</span
          >
        </div>
      </button>
    `;
  }

  private renderNameInput() {
    return html`
      <div
        class="w-full aspect-[2/1] rounded-xl border border-malibu-blue/40 bg-malibu-blue/10 p-3 flex flex-col justify-center gap-2"
      >
        <input
          type="text"
          .value=${this.draftName}
          @input=${(e: Event) =>
            (this.draftName = (e.target as HTMLInputElement).value)}
          placeholder=${translateText("map.template_name_placeholder")}
          class="w-full px-2 py-1.5 rounded-md bg-black/40 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-malibu-blue/60"
          maxlength="40"
          autofocus
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this.confirmCreate();
            if (e.key === "Escape") this.cancelCreate();
          }}
        />
        <div class="flex gap-1.5">
          <button
            type="button"
            @click=${this.cancelCreate}
            class="flex-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/10 hover:bg-white/20 text-white/80"
          >
            ${translateText("common.cancel")}
          </button>
          <button
            type="button"
            @click=${this.confirmCreate}
            class="flex-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-malibu-blue/30 hover:bg-malibu-blue/50 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            ?disabled=${this.draftName.trim() === ""}
          >
            ${translateText("common.confirm")}
          </button>
        </div>
      </div>
    `;
  }

  private mapKeyFor(mapValue: GameMapType): string | undefined {
    return Object.entries(GameMapType).find(
      ([_, value]) => value === mapValue,
    )?.[0];
  }

  private beginCreate = () => {
    this.creating = true;
    this.draftName = "";
  };

  private cancelCreate = () => {
    this.creating = false;
    this.draftName = "";
  };

  private confirmCreate = () => {
    const name = this.draftName.trim();
    if (name === "") return;
    this.onSaveTemplate?.(name);
    this.creating = false;
    this.draftName = "";
  };

  private renderTemplateCard(t: LobbyTemplate) {
    const mapLabel = t.config.useRandomMap
      ? translateText("map.random")
      : translateText(`map.${this.mapKeyFor(t.config.selectedMap)?.toLowerCase()}`);
    return html`
      <div
        class="relative w-full aspect-[2/1] rounded-xl border bg-white/5 border-white/10 hover:bg-malibu-blue/10 hover:border-malibu-blue/40 hover:-translate-y-1 cursor-pointer transition-all duration-200 active:scale-95 overflow-hidden"
        @click=${() => this.onApplyTemplate?.(t.id)}
        title=${t.name}
      >
        <div class="absolute inset-0 p-3 flex flex-col justify-end gap-0.5">
          <span
            class="text-sm font-bold uppercase tracking-wider text-white truncate leading-tight"
            >${t.name}</span
          >
          <span
            class="text-[10px] font-medium uppercase tracking-wider text-white/50 truncate leading-tight"
            >${mapLabel}</span
          >
        </div>
        <button
          type="button"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.onDeleteTemplate?.(t.id);
          }}
          class="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500/80 text-white/80 hover:text-white transition-colors"
          title=${translateText("map.delete_template")}
          aria-label=${translateText("map.delete_template")}
        >
          ×
        </button>
      </div>
    `;
  }

  render() {
    const hasTemplates = this.hasTemplatesTab();
    return html`
      <div class="space-y-8">
        ${hasTemplates
          ? html`<div class="w-full">
              <div
                role="tablist"
                aria-label="${translateText("map.map")}"
                class="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected=${this.activeTab === "maps"}
                  class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all active:scale-95 ${this
                    .activeTab === "maps"
                    ? "bg-malibu-blue/20 text-white shadow-[var(--shadow-malibu-blue-soft)]"
                    : "text-white/60 hover:text-white"}"
                  @click=${() => (this.activeTab = "maps")}
                >
                  ${translateText("map.all")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected=${this.activeTab === "templates"}
                  class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all active:scale-95 ${this
                    .activeTab === "templates"
                    ? "bg-malibu-blue/20 text-white shadow-[var(--shadow-malibu-blue-soft)]"
                    : "text-white/60 hover:text-white"}"
                  @click=${() => (this.activeTab = "templates")}
                >
                  ${translateText("map.templates")}
                </button>
              </div>
            </div>`
          : nothing}
        ${this.activeTab === "templates" && hasTemplates
          ? this.renderTemplatesTab()
          : this.renderAllMaps()}
        <div
          class="w-full ${this.randomMapDivider
            ? "pt-4 border-t border-white/5"
            : ""}"
        >
          <h4
            class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
          >
            ${translateText("map_categories.special")}
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
                .useRandomMap
                ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  draggable="false"
                  @dragstart=${this.preventImageDrag}
                  class="w-full h-full object-cover ${this.useRandomMap
                    ? "opacity-100"
                    : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                />
              </div>
              <div
                class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
              >
                ${translateText("map.random")}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
