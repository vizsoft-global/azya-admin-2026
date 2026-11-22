import { describe, expect, it } from "vitest";
import { readCounters } from "@/lib/id-map";
import { mailRecord } from "@/lib/mail";
import { mediaItem, mediaRecord, newImageId } from "@/lib/media";
import { lineInScope, orderInScope, orderLinesInScope, ownedInScope, scopeOf } from "@/lib/role-scope";
import { uploadPath } from "@/lib/upload";

describe("role scope", () => {
  const designer = scopeOf({ id: "doc1", role_unique_key: "designer", user_role: "Designer", display_name: "Dana", email: "d@x.co" }, "u1");
  const staff = scopeOf({ role_unique_key: "manager" }, "u2");

  it("reads who is signed in", () => {
    expect(designer).toMatchObject({ uid: "u1", roleKey: "designer", isDesigner: true, isSuperAdmin: false, displayName: "Dana", userDocId: "doc1" });
    expect(staff.isDesigner).toBe(false);
  });
  it("treats only the super admin role key as super admin", () => {
    expect(scopeOf({ role_unique_key: "super_admin" }, "u").isSuperAdmin).toBe(true);
    expect(scopeOf({ role_unique_key: "ops", user_role: "SuperAdmin" }, "u").isSuperAdmin).toBe(false);
    expect(scopeOf(null, "").isSuperAdmin).toBe(false);
  });
  it("shows a designer only their own records", () => {
    expect(ownedInScope(designer, "u1")).toBe(true);
    expect(ownedInScope(designer, "u9")).toBe(false);
    expect(ownedInScope(designer, undefined)).toBe(false);
    expect(ownedInScope(staff, "u9")).toBe(true);
    expect(ownedInScope(scopeOf({ role_unique_key: "designer" }, ""), "")).toBe(false);
  });
  it("scopes order lines by product_designer_id", () => {
    const order = { order_items: { cart_items: [{ product_designer_id: "u1", n: 1 }, { product_designer_id: "u9", n: 2 }] } };
    expect(lineInScope(designer, order.order_items.cart_items[1])).toBe(false);
    expect(orderLinesInScope(designer, order)).toEqual([{ product_designer_id: "u1", n: 1 }]);
    expect(orderLinesInScope(staff, order)).toHaveLength(2);
    expect(orderInScope(designer, order)).toBe(true);
    expect(orderInScope(designer, { order_items: { cart_items: [{ product_designer_id: "u9" }] } })).toBe(false);
    expect(orderInScope(designer, {})).toBe(false);
    expect(orderInScope(staff, {})).toBe(true);
  });
});

describe("id counters", () => {
  it("returns the stored numbers", () => {
    expect(readCounters({ coupon_id: 7, tag_id: 3 }, ["coupon_id", "tag_id"])).toEqual({ ids: { coupon_id: 7, tag_id: 3 } });
  });
  it("names a counter that is missing or not a whole number", () => {
    expect(readCounters({ coupon_id: 7 }, ["coupon_id", "tag_id"])).toEqual({ missing: "tag_id" });
    expect(readCounters({ coupon_id: "7" }, ["coupon_id"])).toEqual({ missing: "coupon_id" });
    expect(readCounters(undefined, ["coupon_id"])).toEqual({ missing: "coupon_id" });
  });
});

describe("mail", () => {
  it("builds the record the email service reads", () => {
    expect(mailRecord({ to: " a@b.co ", template: "T", data: { name: "A" } }, "NOW")).toEqual({ created_at: "NOW", to: "a@b.co", template: { name: "T", data: { name: "A" } } });
  });
  it("refuses an empty address", () => {
    expect(() => mailRecord({ to: "  ", template: "T", data: {} }, "NOW")).toThrow(/no email address/);
  });
});

describe("uploads and media", () => {
  it("puts every upload under the signed-in person's folder", () => {
    expect(uploadPath("u1", "/media/", "my photo (1).png", 5)).toBe("users/u1/media/5-my-photo-1-.png");
    expect(uploadPath("u1", "", "a.png", 5)).toBe("users/u1/5-a.png");
  });
  it("writes the fields the app reads", () => {
    const record = mediaRecord({ url: "https://x/y.png", fileName: "y.png", uid: "u1", imageId: "IMG-1", now: "NOW" });
    expect(record).toEqual({ image_id: "IMG-1", image_name: "y.png", created_at: "NOW", feature_image: "https://x/y.png", image_alt_text: "", image_responsive_list: [], image_uid: "u1" });
    expect(mediaItem("d1", record)).toEqual({ id: "d1", url: "https://x/y.png", imageId: "IMG-1", name: "y.png", uploaderUid: "u1" });
  });
  it("mints a short image id", () => {
    expect(newImageId(1000, 0)).toBe("IMG-rs-00");
    expect(newImageId(1000, 0.999)).toMatch(/^IMG-rs-[0-9a-z]{2}$/);
  });
});
