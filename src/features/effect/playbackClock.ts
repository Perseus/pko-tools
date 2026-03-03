import { useSyncExternalStore } from "react";

type PlaybackListener = () => void;

class PlaybackClockStore {
  private currentTime = 0;
  private listeners = new Set<PlaybackListener>();

  get = (): number => this.currentTime;

  set = (time: number): void => {
    if (time === this.currentTime) {
      return;
    }
    this.currentTime = time;
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: PlaybackListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const playbackClockStore = new PlaybackClockStore();

export function usePlaybackClock(): number {
  return useSyncExternalStore(
    playbackClockStore.subscribe,
    playbackClockStore.get,
    playbackClockStore.get,
  );
}
