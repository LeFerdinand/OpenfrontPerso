import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  COLOR_KEY,
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../core/game/UserSettings";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("pattern-input")
export class PatternInput extends LitElement {
  @state() public selectedColor: string | null = null;
  @state() private isLoading: boolean = true;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  @property({ type: Boolean, attribute: "adaptive-size" })
  public adaptiveSize: boolean = false;

  private _abortController: AbortController | null = null;

  private _onCosmeticsChanged = async () => {
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
  };

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("pattern-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  async connectedCallback() {
    super.connectedCallback();
    this._abortController = new AbortController();
    this.isLoading = true;
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    if (!this.isConnected) return;
    this.isLoading = false;
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${COLOR_KEY}`,
      this._onCosmeticsChanged,
      { signal: this._abortController.signal },
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticsChanged,
      { signal: this._abortController.signal },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  createRenderRoot() {
    return this;
  }

  private getIsDefaultColor(): boolean {
    return this.selectedColor === null;
  }

  private shouldShowSelectLabel(): boolean {
    return this.showSelectLabel && this.getIsDefaultColor();
  }

  private applyAdaptiveSize(): void {
    if (!this.adaptiveSize) {
      this.style.removeProperty("width");
      this.style.removeProperty("height");
      return;
    }

    const showSelect = this.showSelectLabel && this.getIsDefaultColor();
    this.style.setProperty("height", "2.5rem");
    this.style.setProperty(
      "width",
      showSelect ? "clamp(3.25rem, 14vw, 4.75rem)" : "2.5rem",
    );
  }

  protected updated(): void {
    this.applyAdaptiveSize();
  }

  render() {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }

    const showSelect = this.shouldShowSelectLabel();
    const buttonTitle = translateText("territory_patterns.title");

    // Show loading state
    if (this.isLoading) {
      return html`
        <button
          id="pattern-input"
          class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-surface rounded-lg overflow-hidden"
          disabled
        >
          <span
            class="w-6 h-6 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
          ></span>
        </button>
      `;
    }

    const swatchStyle =
      this.selectedColor !== null
        ? `background-color: ${this.selectedColor};`
        : "";

    return html`
      <button
        id="pattern-input"
        class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:shadow-[var(--shadow-action-card-hover)] rounded-lg overflow-hidden"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        ${showSelect
          ? html`<span
              class="${this.adaptiveSize
                ? "text-[7px] leading-tight px-0.5"
                : "text-[10px] leading-none break-words px-1"} font-black text-white uppercase w-full text-center"
            >
              ${translateText("territory_patterns.select_skin")}
            </span>`
          : html`<span
              class="block w-full h-full rounded-lg"
              style=${swatchStyle}
            ></span>`}
      </button>
    `;
  }
}
