// @vitest-environment node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import manifest from "../public/manifest.json";

describe("extension manifest", () => {
  it("uses Manifest V3 with only the approved permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage", "contextMenus", "clipboardWrite"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("references existing PNG icons at every Chrome size", () => {
    for (const iconPath of Object.values(manifest.icons)) {
      expect(existsSync(resolve("public", iconPath))).toBe(true);
      expect(iconPath.endsWith(".png")).toBe(true);
    }
  });

  it("keeps the extension and package versions aligned", () => {
    expect(manifest.version).toBe("0.1.1");
    expect(manifest.version).toBe(packageJson.version);
  });
});
