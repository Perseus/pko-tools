import "@testing-library/jest-dom";
import { vi } from "vitest";

const suppressedPatterns = [
  "is using incorrect casing",
  "is unrecognized in this browser",
  "React does not recognize the",
  "Received `true` for a non-boolean attribute",
  "non-boolean attribute",
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
