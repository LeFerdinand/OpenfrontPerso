import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { HostLobbyModal } from "./HostLobbyModal";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UsernameInput } from "./UsernameInput";
import { translateText } from "./Utils";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  createRenderRoot() {
    return this;
  }

  /**
   * Kept as a no-op so external callers in Main.ts (which call
   * `stop()` when the game starts) don't break. The original
   * implementation closed the public-lobby WebSocket; we no longer
   * open one because public lobbies + Join + Ranked have been
   * removed from the homepage.
   */
  public stop() {}

  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.validateOrShowError() : true;
  }

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  render() {
    return html`
      <div
        class="flex items-center justify-center w-full px-4 sm:px-0 py-12 sm:py-24"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-4xl">
          <button
            @click=${this.openSinglePlayerModal}
            class="h-28 sm:h-36 rounded-xl bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 transition-all duration-200 text-lg lg:text-2xl font-medium text-white uppercase tracking-wider hover:scale-[1.03]"
          >
            ${translateText("main.solo")}
          </button>
          <button
            @click=${this.openHostLobby}
            class="h-28 sm:h-36 rounded-xl bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-[1.03] hover:shadow-[var(--shadow-action-card-hover)] transition-all duration-200 text-lg lg:text-2xl font-medium text-white uppercase tracking-wider"
          >
            ${translateText("main.create")}
          </button>
        </div>
      </div>
    `;
  }
}
