/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Directive } from "vue";
import { defineNuxtPlugin } from "#app";

type TimeMaskMode = "mmss" | "hhmmss";
type TimeMaskBinding =
  | TimeMaskMode
  | {
      mode?: TimeMaskMode | "auto";
      padOnBlur?: boolean;
    };

interface TimeMaskConfig {
  mode: TimeMaskMode;
  padOnBlur: boolean;
}

interface Handlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onInput: (e: Event) => void;
  onPaste: (e: ClipboardEvent) => void;
  onBlur: (e: FocusEvent) => void;
}

const stateMap = new WeakMap<
  HTMLInputElement,
  { config: TimeMaskConfig; handlers: Handlers }
>();

function getDigits(value: string) {
  return value.replace(/\D+/g, "");
}

function limitDigits(digits: string, mode: TimeMaskMode): string {
  return digits.slice(0, mode === "mmss" ? 4 : 6);
}

function formatOnInput(digits: string, mode: TimeMaskMode): string {
  const d = limitDigits(digits, mode);
  if (mode === "mmss") {
    if (d.length <= 2) return d; // only seconds for now
    // minutes (left), seconds (right 2)
    const left = d.slice(0, d.length - 2);
    const sec = d.slice(-2);
    return `${left}:${sec}`;
  } else {
    if (d.length <= 2) return d; // only seconds
    if (d.length <= 4) {
      // minutes + seconds
      const left = d.slice(0, d.length - 2);
      const sec = d.slice(-2);
      return `${left}:${sec}`;
    }
    // hours + minutes + seconds
    const hours = d.slice(0, d.length - 4);
    const minutes = d.slice(-4, -2);
    const seconds = d.slice(-2);
    return `${hours}:${minutes}:${seconds}`;
  }
}

function formatOnBlur(digits: string, mode: TimeMaskMode): string {
  const d = limitDigits(digits, mode);

  if (!d.length) return "";

  if (mode === "mmss") {
    if (d.length <= 2) {
      // Only seconds entered, pad to 0:SS
      const ss = d.padStart(2, "0");
      return `0:${ss}`;
    }
    const left = d.slice(0, d.length - 2); // minutes, 1-2 digits
    const ss = d.slice(-2).padStart(2, "0");
    return `${parseInt(left, 10)}:${ss}`;
  } else {
    // hhmmss
    if (d.length <= 2) {
      // Only seconds entered -> 0:00:SS
      const ss = d.padStart(2, "0");
      return `0:00:${ss}`;
    }
    if (d.length <= 4) {
      // minutes + seconds -> 0:MM:SS (MM and SS 2 digits)
      const mm = d.slice(0, d.length - 2).padStart(2, "0");
      const ss = d.slice(-2).padStart(2, "0");
      return `0:${mm}:${ss}`;
    }
    // hours + minutes + seconds
    const hours = String(parseInt(d.slice(0, d.length - 4), 10)); // 1-2 digits, no left pad
    const mm = d.slice(-4, -2).padStart(2, "0");
    const ss = d.slice(-2).padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
}

function digitIndexFromMaskedIndex(
  masked: string,
  maskedIndex: number,
): number {
  let count = 0;
  for (let i = 0; i < Math.min(maskedIndex, masked.length); i++) {
    if (/\d/.test(masked[i]!)) count++;
  }
  return count;
}

function maskedIndexFromDigitIndex(masked: string, digitIndex: number): number {
  if (digitIndex <= 0) return 0;
  let count = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i]!)) {
      count++;
      if (count === digitIndex) {
        // caret goes after this digit
        return i + 1;
      }
    }
  }
  return masked.length;
}

function resolveMode(
  el: HTMLInputElement,
  binding: TimeMaskBinding | undefined,
): TimeMaskMode {
  // From explicit binding value
  if (typeof binding === "string") {
    return binding === "hhmmss" ? "hhmmss" : "mmss";
  }
  if (
    binding &&
    typeof binding === "object" &&
    binding.mode &&
    binding.mode !== "auto"
  ) {
    return binding.mode === "hhmmss" ? "hhmmss" : "mmss";
  }

  // From data attribute
  const dataAttr = (
    el.dataset.timeFormat ||
    el.getAttribute("data-time-format") ||
    ""
  ).toLowerCase();
  if (dataAttr === "hhmmss" || dataAttr === "mmss") {
    return dataAttr as TimeMaskMode;
  }

  // From placeholder or pattern hints
  const pattern = (el.getAttribute("pattern") || "").toLowerCase();
  const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
  const sample = pattern || placeholder;

  if ((sample.match(/:/g) || []).length >= 2) return "hhmmss";
  if ((sample.match(/:/g) || []).length === 1) return "mmss";

  // Default: MM:SS
  return "mmss";
}

function resolveConfig(el: HTMLInputElement, binding: any): TimeMaskConfig {
  const mode = resolveMode(el, binding?.value);
  const padOnBlur =
    typeof binding?.value === "object" && "padOnBlur" in binding.value
      ? Boolean(binding.value.padOnBlur)
      : true;

  return { mode, padOnBlur };
}

function isAllowedKey(e: KeyboardEvent): boolean {
  // Allow navigation, editing keys
  const allowed = [
    "Backspace",
    "Delete",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "Enter",
    "Escape",
  ];
  if (allowed.includes(e.key)) return true;

  // Allow Ctrl/Cmd combos (copy/paste/select all/cut/undo/redo)
  if (e.ctrlKey || e.metaKey) return true;

  // Allow number keys
  return /^[0-9]$/.test(e.key);
}

function attachHandlers(
  el: HTMLInputElement,
  config: TimeMaskConfig,
): Handlers {
  // Improve mobile keypad
  if (!el.getAttribute("inputmode")) {
    el.setAttribute("inputmode", "numeric");
  }
  // Prevent browser autocomplete jitter
  if (!el.getAttribute("autocomplete")) {
    el.setAttribute("autocomplete", "off");
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isAllowedKey(e)) {
      e.preventDefault();
    }
  };

  const onInput = (_e: Event) => {
    const raw = el.value || "";
    const caret = el.selectionStart ?? raw.length;

    const currentDigitIndex = digitIndexFromMaskedIndex(raw, caret);
    const digits = getDigits(raw);
    const limited = limitDigits(digits, config.mode);
    const masked = formatOnInput(limited, config.mode);

    if (masked !== raw) {
      el.value = masked;
    }

    const newCaret = maskedIndexFromDigitIndex(
      masked,
      Math.min(currentDigitIndex, limited.length),
    );
    try {
      el.setSelectionRange(newCaret, newCaret);
    } catch {
      // ignore if unsupported
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text") ?? "";
    const pasteDigits = getDigits(text);
    if (!pasteDigits) {
      // Nothing useful to paste; block non-numeric paste
      e.preventDefault();
      return;
    }

    e.preventDefault();

    const raw = el.value || "";
    const selStart = el.selectionStart ?? raw.length;
    const selEnd = el.selectionEnd ?? raw.length;

    // Map masked selection to digit indexes
    const startDigitIdx = digitIndexFromMaskedIndex(raw, selStart);
    const endDigitIdx = digitIndexFromMaskedIndex(raw, selEnd);

    const currentDigits = getDigits(raw);
    // Replace selected digit range with pasted digits
    const newDigits =
      currentDigits.slice(0, startDigitIdx) +
      pasteDigits +
      currentDigits.slice(endDigitIdx);

    const limited = limitDigits(newDigits, config.mode);
    const masked = formatOnInput(limited, config.mode);

    el.value = masked;

    // Caret after the pasted digits
    const caretDigitIdx = Math.min(
      startDigitIdx + pasteDigits.length,
      limited.length,
    );
    const newCaret = maskedIndexFromDigitIndex(masked, caretDigitIdx);
    try {
      el.setSelectionRange(newCaret, newCaret);
    } catch {
      // ignore
    }

    // Fire input event to update v-model after programmatic change
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const onBlur = (_e: FocusEvent) => {
    if (!config.padOnBlur) return;

    const raw = el.value || "";
    const digits = getDigits(raw);
    if (!digits.length) return;

    const masked = formatOnBlur(digits, config.mode);

    if (masked !== raw) {
      el.value = masked;
      // Sync v-model since this is a programmatic change on blur
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("input", onInput);
  el.addEventListener("paste", onPaste);
  el.addEventListener("blur", onBlur);

  return { onKeyDown, onInput, onPaste, onBlur };
}

function detachHandlers(el: HTMLInputElement, handlers: Handlers) {
  el.removeEventListener("keydown", handlers.onKeyDown);
  el.removeEventListener("input", handlers.onInput);
  el.removeEventListener("paste", handlers.onPaste);
  el.removeEventListener("blur", handlers.onBlur);
}

const timeMaskDirective: Directive<HTMLInputElement, TimeMaskBinding> = {
  mounted(el, binding) {
    // Only attach to text-like inputs
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type && type !== "text" && type !== "search" && type !== "tel") {
      // Skip native time/date inputs etc.
      return;
    }

    const config = resolveConfig(el, binding);
    const handlers = attachHandlers(el, config);

    stateMap.set(el, { config, handlers });

    // Initial normalization (e.g., if v-model has a prefed value)
    const digits = getDigits(el.value || "");
    if (digits) {
      const masked = formatOnInput(
        limitDigits(digits, config.mode),
        config.mode,
      );
      if (masked !== el.value) {
        el.value = masked;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  },

  updated(el, binding) {
    const state = stateMap.get(el);
    const newConfig = resolveConfig(el, binding);

    // If config changed, reattach listeners to be safe
    if (!state) {
      const handlers = attachHandlers(el, newConfig);
      stateMap.set(el, { config: newConfig, handlers });
      return;
    }

    const sameMode = state.config.mode === newConfig.mode;
    const samePad = state.config.padOnBlur === newConfig.padOnBlur;
    if (!sameMode || !samePad) {
      // Rebind to apply new behavior
      detachHandlers(el, state.handlers);
      const handlers = attachHandlers(el, newConfig);
      stateMap.set(el, { config: newConfig, handlers });

      // Reformat current value to new mode
      const digits = getDigits(el.value || "");
      const masked = newConfig.padOnBlur
        ? formatOnBlur(digits, newConfig.mode)
        : formatOnInput(limitDigits(digits, newConfig.mode), newConfig.mode);
      if (masked !== el.value) {
        el.value = masked;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  },

  beforeUnmount(el) {
    const state = stateMap.get(el);
    if (state) {
      detachHandlers(el, state.handlers);
      stateMap.delete(el);
    }
  },
};

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive("time-mask", timeMaskDirective);
});

/*
Usage:

1) Global directive is registered as v-time-mask.

2) Apply to inputs that should capture time-like values:

   <!-- MM:SS -->
   <input v-time-mask="'mmss'" type="text" placeholder="7:30" />

   <!-- HH:MM:SS -->
   <input v-time-mask="'hhmmss'" type="text" placeholder="3:45:00" />

   <!-- Auto-detect from placeholder/pattern (falls back to MM:SS) -->
   <input v-time-mask type="text" placeholder="HH:MM:SS" />

   <!-- With options -->
   <input v-time-mask="{ mode: 'hhmmss', padOnBlur: true }" type="text" />

   <!-- Or via data attribute -->
   <input v-time-mask data-time-format="hhmmss" type="text" />

Behavior:
- Only numerals are allowed (besides navigation/editing keys).
- Colons are auto-inserted/removed as users type.
- Pasting non-numeric content is sanitized.
- On blur, the value is padded to produce a valid time (e.g., "0:07" for MM:SS or "0:00:07" for HH:MM:SS).
*/
