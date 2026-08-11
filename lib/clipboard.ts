/**
 * Clipboard read/write that survives the Capacitor Android WebView.
 *
 * `navigator.clipboard` needs a secure context and isn't present in every
 * WebView the shell runs in, so both helpers fall back to the legacy
 * `execCommand` path rather than throwing on those devices.
 */

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const scratch = document.createElement("textarea");
    scratch.value = text;
    // Off-screen rather than `display: none` — a hidden element can't be
    // selected, which is what execCommand("copy") operates on.
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Returns clipboard text, or null when reading isn't permitted.
 *
 * Unlike writing, there is no `execCommand` fallback for reading — Safari and
 * Firefox don't expose `readText` at all, and Chromium prompts for permission.
 * Callers must keep manual entry available rather than treating a null as an
 * error; use `canPasteFromClipboard()` to decide whether to offer the button.
 */
export async function readText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export function canPasteFromClipboard(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);
}
