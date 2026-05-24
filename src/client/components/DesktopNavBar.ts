import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="pix-nav hidden lg:grid w-full items-center py-4 shrink-0 z-50 relative"
      >
        <!-- LEFT: brand stack (click → site principal) -->
        <a
          class="pix-nav__brand"
          href="https://lataniereplay.fr"
          aria-label="Retour à La tanière"
        >
          <div class="pix-nav__brand-main">OPENFRONT</div>
          <div class="pix-nav__brand-sub">La tanière</div>
        </a>

        <!-- CENTER: tabs -->
        <div class="pix-nav__tabs">
          <button
            class="nav-menu-item ${currentPage === "page-play"
              ? "active"
              : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
            data-page="page-play"
            data-i18n="main.play"
          ></button>
          <div class="relative">
            <button
              class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
              data-page="page-help"
              data-i18n="main.help"
              @click=${this._notifications.onHelpClick}
            ></button>
            ${this._notifications.showHelpDot()
              ? html`
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping"
                  ></span>
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full"
                  ></span>
                `
              : ""}
          </div>
          <button
            class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
            data-page="page-settings"
            data-i18n="main.settings"
          ></button>
        </div>

        <!-- RIGHT: spacer pour équilibrer la grille -->
        <div></div>
      </nav>
    `;
  }
}
