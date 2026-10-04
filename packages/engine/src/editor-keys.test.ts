import { describe, expect, it } from "vitest";
import { activatesFocusedControl, isTyping, type KeyTarget } from "./editor";

/** A fake element: `ancestors` are the selectors `closest` finds, `focusVisible` answers `:focus-visible`. */
const el = (o: { tag?: string; editable?: boolean; ancestors?: string[]; focusVisible?: boolean | "throws" } = {}): KeyTarget => ({
  tagName: o.tag ?? "DIV",
  isContentEditable: o.editable ?? false,
  closest: (selector) => (selector.split(",").some((s) => (o.ancestors ?? []).includes(s.trim())) ? {} : null),
  matches: (selector) => {
    if (selector !== ":focus-visible") return false;
    if (o.focusVisible === "throws") throw new SyntaxError("unsupported selector");
    return o.focusVisible ?? false;
  },
});

describe("isTyping", () => {
  it("is true in fields, editable content, dialogs and open menus", () => {
    expect(isTyping(el({ tag: "INPUT" }))).toBe(true);
    expect(isTyping(el({ tag: "TEXTAREA" }))).toBe(true);
    expect(isTyping(el({ tag: "SELECT" }))).toBe(true);
    expect(isTyping(el({ editable: true }))).toBe(true);
    expect(isTyping(el({ ancestors: ["dialog"] }))).toBe(true);
    expect(isTyping(el({ ancestors: ["[role=menu]"] }))).toBe(true);
  });

  it("is false for the page, a button outside a menu, and non-elements", () => {
    expect(isTyping(el())).toBe(false);
    expect(isTyping(el({ tag: "BUTTON", ancestors: ["button"] }))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping({})).toBe(false);
  });
});

describe("activatesFocusedControl", () => {
  const button = (focusVisible: boolean | "throws") => el({ tag: "BUTTON", ancestors: ["button"], focusVisible });

  it("lets Enter and Space activate a keyboard-focused button, link, role=button or summary", () => {
    for (const ancestor of ["button", "a[href]", "[role=button]", "summary"]) {
      const target = el({ ancestors: [ancestor], focusVisible: true });
      expect(activatesFocusedControl(target, "Enter"), ancestor).toBe(true);
      expect(activatesFocusedControl(target, " "), ancestor).toBe(true);
    }
  });

  it("leaves Enter and Space to the canvas after a mouse click (no visible focus)", () => {
    expect(activatesFocusedControl(button(false), "Enter")).toBe(false);
    expect(activatesFocusedControl(button(false), " ")).toBe(false);
  });

  it("only guards Enter and Space", () => {
    expect(activatesFocusedControl(button(true), "Delete")).toBe(false);
    expect(activatesFocusedControl(button(true), "ArrowLeft")).toBe(false);
  });

  it("ignores focus on anything that is not a control", () => {
    expect(activatesFocusedControl(el({ focusVisible: true }), "Enter")).toBe(false);
    expect(activatesFocusedControl(null, "Enter")).toBe(false);
    expect(activatesFocusedControl({}, "Enter")).toBe(false);
  });

  it("does not throw where :focus-visible is unsupported, and leaves the key to the canvas", () => {
    expect(activatesFocusedControl(button("throws"), "Enter")).toBe(false);
  });
});
