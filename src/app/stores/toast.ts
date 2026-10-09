import { create } from 'zustand';
import { TOAST_MS } from '../../ui/theme/metrics';

interface ToastState {
  message: string | null;
  show: (message: string) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Single global toast; a new message replaces the current one and restarts the 2.6 s timer. */
export const useToastStore = create<ToastState>()(set => ({
  message: null,
  show: message => {
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), TOAST_MS);
  },
  hide: () => {
    clearTimeout(timer);
    set({ message: null });
  },
}));

export const showToast = (message: string) => useToastStore.getState().show(message);
