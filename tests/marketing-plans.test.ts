import { describe, expect, it } from "vitest";
import { inboxItem, markReadPayload, sortInbox, unreadOnly } from "@/features/marketing/inbox-rules";
import { canDeleteMedia, mediaLabel, searchMedia } from "@/features/marketing/media-rules";
import {
  creditHolders,
  emptyPlanForm,
  isActive,
  nextPlanId,
  packCreatePayload,
  packFormFromDoc,
  packUpdatePayload,
  planCreatePayload,
  planFormFromDoc,
  planUpdatePayload,
  statusChange,
  validatePack,
  validatePlan,
} from "@/features/marketing/plan-rules";

describe("try-on credit packs", () => {
  const form = { name: " Starter ", credits: 10, price: 2.5 };
  it("writes the record the app lists, active and numbered from the counter", () => {
    expect(packCreatePayload(form, 14, "NOW")).toEqual({ price: 2.5, created_at: "NOW", updated_at: "NOW", status: "active", vto_plan_id: 14, vto_info: { name: "Starter" }, vto_point: 10 });
  });
  it("reads a pack back and updates only what changed", () => {
    const before = packFormFromDoc({ vto_info: { name: "Starter" }, vto_point: 10, price: 2.5 });
    expect(before).toEqual({ name: "Starter", credits: 10, price: 2.5 });
    expect(packUpdatePayload(before, before, "NOW")).toEqual({});
    expect(packUpdatePayload(before, { ...before, price: 3 }, "NOW")).toEqual({ price: 3, updated_at: "NOW" });
    expect(packUpdatePayload(before, { ...before, name: "Plus" }, "NOW")).toEqual({ "vto_info.name": "Plus", updated_at: "NOW" });
  });
  it("validates name, credits and price", () => {
    expect(validatePack({ name: "Starter", credits: 10, price: 0 })).toEqual({});
    expect(Object.keys(validatePack({ name: "", credits: 0, price: null })).sort()).toEqual(["credits", "name", "price"]);
    expect(validatePack({ name: "x".repeat(31), credits: 1.5, price: 1 })).toMatchObject({ name: expect.any(String), credits: expect.any(String) });
  });
  it("archives instead of deleting", () => {
    expect(statusChange("archived", "NOW")).toEqual({ status: "archived", updated_at: "NOW" });
    expect(isActive({ status: "active" })).toBe(true);
    expect(isActive({ status: "Published" })).toBe(false);
  });
  it("lists people with credits, most first", () => {
    const rows = [
      { id: "a", data: { user_vto: { user_vto_credit_points: 2 } } },
      { id: "b", data: { user_vto: { user_vto_credit_points: 0 } } },
      { id: "c", data: { user_vto: { user_vto_credit_points: 9 } } },
      { id: "d", data: {} },
    ];
    expect(creditHolders(rows).map((row) => row.id)).toEqual(["c", "a"]);
  });
});

describe("membership plans", () => {
  const form = { ...emptyPlanForm(), name: " Gold ", description: " Best ", price: 15, duration: " 30 days ", features: { access_to_products: true, discounts: true, free_shipping: false, premium_support: false } };
  it("writes the record the app lists", () => {
    expect(planCreatePayload(form, 4, "NOW")).toEqual({
      membership_plan_id: 4,
      plan_info: { name: "Gold", description: "Best" },
      price: 15,
      duration: "30 days",
      created_at: "NOW",
      updated_at: "NOW",
      plan_feature: { access_to_products: true, discounts: true, free_shipping: false, premium_support: false },
      status: "active",
    });
  });
  it("numbers a new plan after the largest in use", () => {
    expect(nextPlanId([1, 2, 7, "x", null, 3.5])).toBe(8);
    expect(nextPlanId([])).toBe(1);
  });
  it("updates single features by dotted path", () => {
    const before = planFormFromDoc(planCreatePayload(form, 4, "NOW"));
    expect(planUpdatePayload(before, before, "NOW")).toEqual({});
    expect(planUpdatePayload(before, { ...before, features: { ...before.features, free_shipping: true } }, "NOW")).toEqual({ "plan_feature.free_shipping": true, updated_at: "NOW" });
    expect(planUpdatePayload(before, { ...before, name: "Platinum", duration: "1 year" }, "NOW")).toEqual({ "plan_info.name": "Platinum", duration: "1 year", updated_at: "NOW" });
  });
  it("validates name, price and duration", () => {
    expect(validatePlan(form)).toEqual({});
    expect(Object.keys(validatePlan(emptyPlanForm())).sort()).toEqual(["duration", "name", "price"]);
  });
});

describe("my notifications", () => {
  const items = [
    inboxItem("a", { message: "Old", created_at: { seconds: 100 }, mark_as_read: true, notification_type: "inventory", message_type: "LOW_STOCK_ALERT" }),
    inboxItem("b", { message: "New", created_at: { seconds: 300 }, mark_as_read: false }),
    inboxItem("c", { message: "No date" }),
  ];
  it("sorts newest first and keeps undated items last", () => {
    expect(sortInbox(items).map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
  it("treats anything not marked read as unread", () => {
    expect(unreadOnly(items).map((item) => item.id)).toEqual(["b", "c"]);
    expect(items[0]).toMatchObject({ type: "inventory", kind: "LOW_STOCK_ALERT", read: true });
  });
  it("marks as read the way the old admin did", () => {
    expect(markReadPayload("NOW")).toEqual({ updated_at: "NOW", mark_as_read: true });
  });
});

describe("media library", () => {
  const mine = { id: "1", url: "u", imageId: "IMG-abc", name: "Eid banner.jpg", uploaderUid: "me" };
  const theirs = { id: "2", url: "u", imageId: "IMG-xyz", name: "", uploaderUid: "them" };
  it("searches by name and short id", () => {
    expect(searchMedia([mine, theirs], "eid")).toEqual([mine]);
    expect(searchMedia([mine, theirs], "XYZ")).toEqual([theirs]);
    expect(searchMedia([mine, theirs], " ")).toHaveLength(2);
  });
  it("lets only people with the edit permission delete, and designers only their own", () => {
    expect(canDeleteMedia(theirs, { mayEdit: false, isDesigner: false, uid: "me" })).toBe(false);
    expect(canDeleteMedia(theirs, { mayEdit: true, isDesigner: false, uid: "me" })).toBe(true);
    expect(canDeleteMedia(theirs, { mayEdit: true, isDesigner: true, uid: "me" })).toBe(false);
    expect(canDeleteMedia(mine, { mayEdit: true, isDesigner: true, uid: "me" })).toBe(true);
    expect(canDeleteMedia(mine, { mayEdit: true, isDesigner: true, uid: "" })).toBe(false);
  });
  it("labels a picture by name, then id", () => {
    expect(mediaLabel(mine)).toBe("Eid banner.jpg");
    expect(mediaLabel(theirs)).toBe("IMG-xyz");
  });
});
