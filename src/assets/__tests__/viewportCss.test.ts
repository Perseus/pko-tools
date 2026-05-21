import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/assets/index.css"), "utf8");

describe("viewport CSS", () => {
  it("prevents the document root from scrolling around the app shell", () => {
    expect(css).toMatch(/html,\s*body,\s*#root\s*{/);
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[^}]*overflow:\s*hidden;/s);
  });
});
