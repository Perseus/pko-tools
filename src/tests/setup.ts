import "@testing-library/jest-dom";
import { vi } from "vitest";

// Enable React act() environment for R3F test renderer
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const suppressedPatterns = [
  "is using incorrect casing",
  "is unrecognized in this browser",
  "React does not recognize the",
  "Received `true` for a non-boolean attribute",
  "non-boolean attribute",
  "Multiple instances of Three.js",
];

const shouldSuppress = (args: unknown[]) => {
  const message = args
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ");

  return suppressedPatterns.some((pattern) => message.includes(pattern));
};

const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  if (shouldSuppress(args)) {
    return;
  }
  originalError(...args);
});

vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
  if (shouldSuppress(args)) {
    return;
  }
  originalWarn(...args);
});

if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverMock,
  });
}

if (
  typeof window !== "undefined" &&
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
