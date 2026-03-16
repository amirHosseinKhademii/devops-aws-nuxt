import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("about page", () => {
  it("contains the expected starter text", async () => {
    const aboutPagePath = new URL("../pages/about.vue", import.meta.url);
    const aboutPageContent = await readFile(aboutPagePath, "utf8");

    expect(aboutPageContent).toContain("test {{ count }}");
    expect(aboutPageContent).toContain("const count = ref<number>(1);");
  });
});
