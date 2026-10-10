import { create } from 'zustand';
import type { AccentName } from '../../ui/theme/palette';
import type { ThemePreference } from '../../ui/theme/ThemeProvider';

/**
 * Appearance settings. In-memory for now: persisting them needs a storage
 * decision (the encrypted DB `meta` table is the natural home once src/db lands).
 */
interface SettingsState {
  theme: ThemePreference;
  accent: AccentName;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentName) => void;
}

export const useSettingsStore = create<SettingsState>()(set => ({
  theme: 'system',
  accent: 'blue',
  setTheme: theme => set({ theme }),
  setAccent: accent => set({ accent }),
}));
