/**
 * Helpers for opening / managing the Desktop Creature window. In Tauri this
 * spawns a transparent always-on-top WebviewWindow; in the browser it falls
 * back to a popup window so the creature view is still demonstrable.
 */

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openCreatureWindow(): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const { WebviewWindow, getAllWebviewWindows } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const existing = await getAllWebviewWindows();
      const found = existing.find((w) => w.label === "creature");
      if (found) {
        await found.show();
        await found.setFocus();
        return true;
      }
      const win = new WebviewWindow("creature", {
        url: "creature.html",
        width: 220,
        height: 220,
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        shadow: false,
        title: "ECHOSEED Creature",
      });
      return new Promise<boolean>((resolve) => {
        win.once("tauri://created", () => resolve(true));
        win.once("tauri://error", () => resolve(false));
      });
    } catch (e) {
      console.warn("Failed to open Tauri creature window", e);
      return false;
    }
  }

  // Browser fallback: popup window loading the creature view.
  try {
    const popup = window.open(
      "creature.html",
      "echoseed-creature",
      "width=220,height=220,menubar=no,toolbar=no,location=no,status=no",
    );
    return !!popup;
  } catch {
    return false;
  }
}
