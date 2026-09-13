import { useEffect, useRef, useSyncExternalStore } from "react";

import type { PaletteItem } from "@/lib/palette";

// Registration order, which is the order the palette lists route actions in.
const registry: PaletteItem[] = [];

const subscribers = new Set<() => void>();

let snapshot: PaletteItem[] = [];

function publishRegistry(): void {
  snapshot = [...registry];
  subscribers.forEach((notify) => notify());
}

export function usePaletteActions(actions: PaletteItem[]): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const identity = actions
    .map(
      ({ id, label, group, keywords, detail, hint }) =>
        `${id}\u0000${label}\u0000${group}\u0000${keywords?.join("\u0002") ?? ""}\u0000${detail ?? ""}\u0000${hint ?? ""}`,
    )
    .join("\u0001");

  useEffect(() => {
    const currentActions = actionsRef.current;

    if (currentActions.length === 0) return;

    const registrations = currentActions.map((action, index) => ({
      ...action,
      run: () => actionsRef.current[index]?.run(),
    }));

    registry.push(...registrations);
    publishRegistry();

    return () => {
      for (const registration of registrations) {
        const index = registry.indexOf(registration);

        if (index !== -1) registry.splice(index, 1);
      }

      publishRegistry();
    };
  }, [identity]);
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);

  return () => subscribers.delete(notify);
}

function getSnapshot(): PaletteItem[] {
  return snapshot;
}

export function useRegisteredPaletteActions(): PaletteItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
