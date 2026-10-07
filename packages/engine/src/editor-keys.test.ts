import { describe, expect, it } from "vitest";
import { activatesFocusedControl, isTyping, keyInputOf, pointerFocusAfterFocusIn, pointerFocusAfterKey, type KeyTarget, type PointerFocus } from "./editor";

/** A fake element: `ancestors` are the selectors `closest` finds. */
const el = (o: { tag?: string; editable?: boolean; ancestors?: string[] } = {}): KeyTarget => ({
  tagName: o.tag ?? "DIV",
  isContentEditable: o.editable ?? false,
  closest: (selector) => (selector.split(",").some((s) => (o.ancestors ?? []).includes(s.trim())) ? {} : null),
});

/** A fake pressed element that contains exactly the given nodes (and itself). */
const pressed = (...inside: unknown[]): PointerFocus => {
  const self: PointerFocus = { contains: (other) => other === self || inside.includes(other) };
  return self;
};

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
  const button = el({ tag: "BUTTON", ancestors: ["button"] });

  it("lets Enter and Space activate a keyboard-focused button, link, role=button or summary", () => {
    for (const ancestor of ["button", "a[href]", "[role=button]", "summary"]) {
      const target = el({ ancestors: [ancestor] });
      expect(activatesFocusedControl(target, "Enter", null), ancestor).toBe(true);
      expect(activatesFocusedControl(target, " ", null), ancestor).toBe(true);
    }
  });

  it("treats a missing pointer record as keyboard focus", () => {
    expect(activatesFocusedControl(button, "Enter")).toBe(true);
  });

  it("leaves Enter and Space to the canvas after a mouse click on that button", () => {
    expect(activatesFocusedControl(button, "Enter", pressed(button))).toBe(false);
    expect(activatesFocusedControl(button, " ", pressed(button))).toBe(false);
  });

  it("still lets a different button take them when the mouse press was elsewhere", () => {
    expect(activatesFocusedControl(button, " ", pressed())).toBe(true);
    expect(activatesFocusedControl(button, "Enter", pressed())).toBe(true);
  });

  it("only guards Enter and Space", () => {
    expect(activatesFocusedControl(button, "Delete")).toBe(false);
    expect(activatesFocusedControl(button, "ArrowLeft")).toBe(false);
    expect(activatesFocusedControl(button, "Tab")).toBe(false);
  });

  it("ignores focus on anything that is not a control", () => {
    expect(activatesFocusedControl(el(), "Enter")).toBe(false);
    expect(activatesFocusedControl(null, "Enter")).toBe(false);
    expect(activatesFocusedControl({}, "Enter")).toBe(false);
  });
});

describe("mouse-focus record", () => {
  const button = el({ tag: "BUTTON", ancestors: ["button"] });
  const other = el({ tag: "BUTTON", ancestors: ["button"] });

  it("clears on Tab and keeps on other keys", () => {
    const p = pressed(button);
    expect(pointerFocusAfterKey(p, "Tab")).toBeNull();
    expect(pointerFocusAfterKey(p, " ")).toBe(p);
    expect(pointerFocusAfterKey(p, "Enter")).toBe(p);
    expect(pointerFocusAfterKey(null, "Tab")).toBeNull();
  });

  it("clears when focus moves outside the pressed element and keeps when it stays inside", () => {
    const p = pressed(button);
    expect(pointerFocusAfterFocusIn(p, button)).toBe(p);
    expect(pointerFocusAfterFocusIn(p, other)).toBeNull();
    expect(pointerFocusAfterFocusIn(null, button)).toBeNull();
  });

  it("makes a keyboard-focused button take Space again after Tab or a focus move", () => {
    const p = pressed(button);
    expect(activatesFocusedControl(button, " ", p)).toBe(false);
    expect(activatesFocusedControl(button, " ", pointerFocusAfterKey(p, "Tab"))).toBe(true);
    expect(activatesFocusedControl(other, " ", pointerFocusAfterFocusIn(p, other))).toBe(true);
  });
});

describe("keyInputOf", () => {
  const press = (o: Partial<Parameters<typeof keyInputOf>[0]>) => ({ key: "a", code: "KeyA", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });

  it("takes the modifier for the platform", () => {
    expect(keyInputOf(press({ metaKey: true }), true)).toEqual({ key: "a", mod: true, shift: false, alt: false });
    expect(keyInputOf(press({ metaKey: true }), false).mod).toBe(false);
    expect(keyInputOf(press({ ctrlKey: true, shiftKey: true }), false)).toEqual({ key: "a", mod: true, shift: true, alt: false });
  });

  it("reads a letter from the physical key when Option is held (macOS types ç for Option+C)", () => {
    expect(keyInputOf(press({ key: "ç", code: "KeyC", altKey: true, metaKey: true }), true)).toEqual({ key: "c", mod: true, shift: false, alt: true });
    expect(keyInputOf(press({ key: "Ò", code: "KeyL", altKey: true, shiftKey: true }), true)).toMatchObject({ key: "l", alt: true, shift: true });
  });

  it("leaves other keys alone, and every key without Alt", () => {
    expect(keyInputOf(press({ key: "ç", code: "KeyC" }), true).key).toBe("ç");
    expect(keyInputOf(press({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }), true).key).toBe("ArrowLeft");
    expect(keyInputOf(press({ key: "¡", code: "Digit1", altKey: true }), true).key).toBe("¡");
  });
});
