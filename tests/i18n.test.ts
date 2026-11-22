import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionary, dictionaryParts } from "@/lib/i18n/dictionary";
import { englishFor, fill, translate } from "@/lib/i18n/tx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every English text passed to tx() or txKey() as a plain string literal, with the file it is in. */
function txLiterals() {
  const found: { file: string; text: string }[] = [];
  const call = /\b(?:tx|txKey)\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/g;
  for (const file of sourceFiles("src")) {
    if (file.includes("lib/i18n/")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(call)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? "";
      found.push({ file, text: JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`) as string });
    }
  }
  return found;
}

describe("translation helper", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(fill("{count} orders by {who}", { count: 3 })).toBe("3 orders by {who}");
    expect(fill("Save")).toBe("Save");
  });
  it("returns English in English and when no Arabic exists", () => {
    expect(translate("en", "Some text nobody translated")).toBe("Some text nobody translated");
    expect(translate("ar", "Some text nobody translated")).toBe("Some text nobody translated");
  });
});

describe("export headers", () => {
  it("turns a translated label back into its English text", () => {
    const [english, arabic] = Object.entries(dictionary).find(([text, ar]) => !/^[a-z-]+:/.test(text) && englishFor(ar) === text) ?? ["", ""];
    expect(english).not.toBe("");
    expect(englishFor(arabic)).toBe(english);
  });
  it("leaves English and unknown text alone", () => {
    expect(englishFor("Order ID")).toBe("Order ID");
    expect(englishFor("نص غير معروف في القاموس")).toBe("نص غير معروف في القاموس");
  });
});

describe("Arabic dictionary", () => {
  const literals = txLiterals();

  it("has Arabic for every text passed to tx()", () => {
    const missing = [...new Set(literals.filter((item) => !dictionary[item.text]).map((item) => `${item.file}: ${item.text}`))];
    expect(missing).toEqual([]);
  });

  it("keeps every placeholder of the English text", () => {
    const broken = Object.entries(dictionary).filter(([english, arabic]) => {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      return names(english) !== names(arabic);
    });
    expect(broken.map(([english]) => english)).toEqual([]);
  });

  it("never gives one English text two different Arabic texts", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [part, entries] of Object.entries(dictionaryParts)) {
      for (const [english, arabic] of Object.entries(entries)) {
        const before = seen.get(english);
        if (before !== undefined && before !== arabic) clashes.push(`${part}: ${english}`);
        seen.set(english, arabic);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("has no empty or untranslated entries", () => {
    const bad = Object.entries(dictionary).filter(([english, arabic]) => !arabic.trim() || (arabic === english && /[A-Za-z]{3,}/.test(english)));
    expect(bad.map(([english]) => english)).toEqual([]);
  });
});
