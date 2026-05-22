/**
 * Player-saved lobby templates.
 *
 * A template is a snapshot of the host-lobby settings (map, difficulty,
 * game mode, bots, toggles, …) that the player can re-apply with one
 * click instead of re-configuring everything by hand. Templates live in
 * localStorage — there is no server-side storage.
 */

import {
  Difficulty,
  GameMapType,
  GameMode,
  UnitType,
} from "../core/game/Game";
import { TeamCountConfig } from "../core/Schemas";

const STORAGE_KEY = "host_lobby_templates";
const STORAGE_VERSION = 1;
const MAX_TEMPLATES = 20;

export interface LobbyTemplate {
  id: string;
  name: string;
  /** ms epoch; used to sort newest first. */
  createdAt: number;
  config: LobbyTemplateConfig;
}

/**
 * Snapshot of every setting the host modal can change. Stored verbatim
 * in localStorage; applied back onto the @state fields when the user
 * clicks a template card.
 */
export interface LobbyTemplateConfig {
  selectedMap: GameMapType;
  useRandomMap: boolean;
  selectedDifficulty: Difficulty;
  gameMode: GameMode;
  teamCount: TeamCountConfig;
  bots: number;
  /** Raw slider value (0 = disabled, otherwise the nation count). */
  nations: number;
  // Toggles
  instantBuild: boolean;
  randomSpawn: boolean;
  donateGold: boolean;
  donateTroops: boolean;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  compactMap: boolean;
  disableAlliances: boolean;
  waterNukes: boolean;
  fogOfWar: boolean;
  // Timed / numeric options
  maxTimer: boolean;
  maxTimerValue?: number;
  goldMultiplier: boolean;
  goldMultiplierValue?: number;
  startingGold: boolean;
  startingGoldValue?: number;
  spawnImmunity: boolean;
  spawnImmunityDurationMinutes?: number;
  disabledUnits: UnitType[];
}

interface StoredEnvelope {
  version: number;
  templates: LobbyTemplate[];
}

export function loadTemplates(): LobbyTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: StoredEnvelope = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.templates)) {
      return [];
    }
    return parsed.templates;
  } catch (e) {
    console.warn("Failed to load lobby templates:", e);
    return [];
  }
}

export function saveTemplates(templates: LobbyTemplate[]): void {
  try {
    const envelope: StoredEnvelope = {
      version: STORAGE_VERSION,
      templates: templates.slice(0, MAX_TEMPLATES),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (e) {
    console.warn("Failed to save lobby templates:", e);
  }
}

export function addTemplate(
  templates: LobbyTemplate[],
  name: string,
  config: LobbyTemplateConfig,
): LobbyTemplate[] {
  const next: LobbyTemplate = {
    id: generateId(),
    name: name.trim() || "Sans nom",
    createdAt: Date.now(),
    config,
  };
  // Newest first.
  return [next, ...templates].slice(0, MAX_TEMPLATES);
}

export function deleteTemplate(
  templates: LobbyTemplate[],
  id: string,
): LobbyTemplate[] {
  return templates.filter((t) => t.id !== id);
}

function generateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
