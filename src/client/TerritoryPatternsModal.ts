import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  COLOR_KEY,
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import { getPlayerCosmetics } from "./Cosmetics";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

/**
 * Curated color palette displayed in the picker. A 6×6 grid of distinct
 * vibrant + neutral colors covering the full spectrum. The free
 * `<input type="color">` at the top lets players pick anything outside
 * this set.
 */
const COLOR_PALETTE: readonly string[] = [
  // Reds / oranges
  "#e74c3c",
  "#c0392b",
  "#ff6b6b",
  "#e67e22",
  "#d35400",
  "#ff8c00",
  // Yellows
  "#f1c40f",
  "#ffd700",
  "#f39c12",
  "#facc15",
  "#fbbf24",
  "#fde047",
  // Greens
  "#2ecc71",
  "#27ae60",
  "#16a085",
  "#22c55e",
  "#15803d",
  "#84cc16",
  // Cyans / teals
  "#1abc9c",
  "#00ced1",
  "#06b6d4",
  "#0891b2",
  "#0e7490",
  "#67e8f9",
  // Blues
  "#3498db",
  "#2980b9",
  "#1d4ed8",
  "#4169e1",
  "#1e3a8a",
  "#60a5fa",
  // Purples / pinks
  "#9b59b6",
  "#8e44ad",
  "#6a0dad",
  "#e91e63",
  "#ec4899",
  "#ff69b4",
  // Browns / neutrals
  "#795548",
  "#a16207",
  "#7f8c8d",
  "#34495e",
  "#1f2937",
  "#f9fafb",
];

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends BaseModal {
  protected routerName = "territory-patterns";

  @state() private selectedColor: string | null = null;
  /**
   * Free color-picker input value (`<input type="color">` requires a
   * concrete hex). Defaults to the selected color, or grey when
   * nothing is selected.
   */
  @state() private pickerValue: string = "#aaaaaa";

  private userSettings: UserSettings = new UserSettings();

  private _onColorSettingChanged = () => {
    void this.updateFromSettings();
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${COLOR_KEY}`,
      this._onColorSettingChanged,
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onColorSettingChanged,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${COLOR_KEY}`,
      this._onColorSettingChanged,
    );
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onColorSettingChanged,
    );
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    if (this.selectedColor !== null) {
      this.pickerValue = this.selectedColor;
    }
    this.requestUpdate();
  }

  protected async onOpen(): Promise<void> {
    await this.updateFromSettings();
  }

  private isHexColor(value: string): boolean {
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
  }

  private selectColor(hex: string | null) {
    if (hex !== null && !this.isHexColor(hex)) return;
    // Picking a custom color overrides any cosmetic pattern that was
    // previously selected — the color would otherwise be ignored in
    // favor of the pattern's palette.
    this.userSettings.setSelectedPatternName(undefined);
    this.userSettings.setSelectedColor(hex);
    this.selectedColor = hex;
    if (hex !== null) this.pickerValue = hex;
    this.showColorSelectedPopup(hex);
    this.close();
  }

  private showColorSelectedPopup(hex: string | null) {
    const label =
      hex === null
        ? translateText("territory_patterns.pattern.default")
        : hex.toUpperCase();
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${label} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
  }

  private handlePickerInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.pickerValue = input.value;
  };

  private handlePickerCommit = () => {
    this.selectColor(this.pickerValue);
  };

  protected renderHeaderSlot() {
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("territory_patterns.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6 p-6">
        <!-- Free color picker -->
        <div
          class="flex items-center justify-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
        >
          <input
            type="color"
            .value=${this.pickerValue}
            @input=${this.handlePickerInput}
            class="w-14 h-14 rounded-lg border border-white/20 bg-transparent cursor-pointer"
            aria-label=${translateText("territory_patterns.select_skin")}
          />
          <span
            class="font-mono text-sm tracking-widest uppercase text-white/80"
          >
            ${this.pickerValue.toUpperCase()}
          </span>
          <o-button
            variant="primary"
            size="sm"
            translationKey="common.confirm"
            @click=${this.handlePickerCommit}
          ></o-button>
        </div>

        <!-- Curated palette swatches -->
        <div
          class="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-3 justify-items-center"
        >
          ${this.renderSwatch(null)}
          ${COLOR_PALETTE.map((c) => this.renderSwatch(c))}
        </div>
      </div>
    `;
  }

  private renderSwatch(hex: string | null): TemplateResult {
    const isSelected =
      (hex === null && this.selectedColor === null) ||
      (hex !== null &&
        this.selectedColor !== null &&
        hex.toLowerCase() === this.selectedColor.toLowerCase());
    const ring = isSelected
      ? "ring-4 ring-malibu-blue ring-offset-2 ring-offset-black"
      : "ring-1 ring-white/20 hover:ring-white/60";
    return html`
      <button
        @click=${() => this.selectColor(hex)}
        class="w-12 h-12 sm:w-14 sm:h-14 rounded-lg transition-transform duration-150 hover:scale-110 ${ring} relative"
        style=${hex === null ? "" : `background-color: ${hex};`}
        title=${hex ?? translateText("territory_patterns.pattern.default")}
        aria-label=${hex ?? translateText("territory_patterns.pattern.default")}
      >
        ${hex === null
          ? html`<span
              class="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white/70 uppercase tracking-wider"
              >${translateText("territory_patterns.pattern.default")}</span
            >`
          : null}
      </button>
    `;
  }
}
