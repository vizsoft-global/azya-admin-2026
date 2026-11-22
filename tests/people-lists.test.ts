import { describe, expect, it } from "vitest";
import {
  BUYER_ORDER_FILTER,
  buyerUids,
  customerMatchesSearch,
  dateRangeFor,
  defaultAddress,
  inDateRange,
  isPaidOrder,
  loyaltyPoints,
  orderTotals,
  readCustomer,
  readCustomerOrder,
  readMembership,
  sortOrdersNewestFirst,
} from "@/features/people/customers";
import {
  designerArchiveUpdate,
  designerLabel,
  designerMatchesSearch,
  designerReevaluateUpdate,
  designerRequestStatusForTab,
  designerTabFilters,
  inDesignerTab,
  isActiveDesigner,
  isRejectedDesigner,
  readDesigner,
} from "@/features/people/designers";
import { isEmail, matchesAny, numberOr, record, text, textList, timeOf } from "@/features/people/util";

describe("customers", () => {
  it("reads an account, falling back through the name and contact fields", () => {
    const joined = new Date(2026, 4, 3, 10, 30);
    expect(readCustomer({ id: "d1", data: { uid: "u1", display_name: "Mona", email: "m@x.kw", phone_number: "+9655", photo_url: "https://p", user_role: "Customer", status: "Published", created_time: joined } })).toEqual({
      id: "d1",
      uid: "u1",
      name: "Mona",
      email: "m@x.kw",
      phone: "+9655",
      photo: "https://p",
      role: "Customer",
      status: "Published",
      joined,
    });
    const fromInfo = readCustomer({ id: "d2", data: { user_info: { first_name: "Mona", last_name: "Ali", email: "i@x.kw", phone_number: "123" } } });
    expect(fromInfo).toMatchObject({ uid: "d2", name: "Mona Ali", email: "i@x.kw", phone: "123", joined: null });
    expect(customerMatchesSearch(fromInfo, "ali")).toBe(true);
    expect(customerMatchesSearch(fromInfo, "zzz")).toBe(false);
  });

  it("works out the joined-date ranges", () => {
    const now = new Date(2026, 10, 18, 15, 0); // a Wednesday
    expect(dateRangeFor("all", now)).toEqual({ from: null, to: null });
    expect(dateRangeFor("today", now)).toEqual({ from: new Date(2026, 10, 18), to: new Date(2026, 10, 18, 23, 59, 59, 999) });
    expect(dateRangeFor("week", now).from).toEqual(new Date(2026, 10, 15)); // the Sunday
    expect(dateRangeFor("month", now).from).toEqual(new Date(2026, 10, 1));
    expect(dateRangeFor("custom", now, { from: new Date(2026, 0, 5, 9), to: new Date(2026, 0, 6, 9) })).toEqual({ from: new Date(2026, 0, 5), to: new Date(2026, 0, 6, 23, 59, 59, 999) });
    expect(dateRangeFor("custom", now)).toEqual({ from: null, to: null });
  });

  it("filters by date, leaving undated accounts out of a dated filter", () => {
    const range = { from: new Date(2026, 0, 5), to: new Date(2026, 0, 6, 23, 59, 59, 999) };
    expect(inDateRange(new Date(2026, 0, 5, 12), range)).toBe(true);
    expect(inDateRange(new Date(2026, 0, 4, 23, 59), range)).toBe(false);
    expect(inDateRange(new Date(2026, 0, 7), range)).toBe(false);
    expect(inDateRange(null, range)).toBe(false);
    expect(inDateRange(null, { from: null, to: null })).toBe(true);
    expect(inDateRange(new Date(2020, 0, 1), { from: null, to: range.to })).toBe(true);
  });

  it("finds buyers from paid orders", () => {
    expect(BUYER_ORDER_FILTER).toEqual([["order_status", "in", ["CAPTURED", "completed"]]]);
    const uids = buyerUids([
      { id: "o1", data: { customer_id: "u1" } },
      { id: "o2", data: { customer_id: "u1" } },
      { id: "o3", data: { customer_id: "" } },
      { id: "o4", data: {} },
      { id: "o5", data: { customer_id: "u2" } },
    ]);
    expect([...uids].sort()).toEqual(["u1", "u2"]);
  });

  it("builds the default delivery address from the account", () => {
    const data = {
      user_shippingaddress: [
        { is_default: false, shipping_address_info: { address_line_1: "Other", city: "Hawally" } },
        { is_default: true, shipping_address_info: { address_line_1: "Street 12", block: "4", building: "9", city: "Salmiya", state: "Hawalli", country: "Kuwait" } },
      ],
    };
    expect(defaultAddress(data)).toBe("Street 12, Block 4, Building 9, Salmiya, Hawalli, Kuwait");
    expect(defaultAddress({ user_shippingaddress: [{ shipping_address_info: { city: "Jahra" } }] })).toBe("Jahra");
    expect(defaultAddress({})).toBe("");
    expect(defaultAddress(null)).toBe("");
  });

  it("reads orders and totals only what was paid", () => {
    const orders = [
      readCustomerOrder({ id: "o1", data: { order_id: "AZ1", created_at: new Date(2026, 0, 1), total_price: 10.1255, payment_method: "KNET", payment_status: "CAPTURED", order_status: "completed", order_items: { cart_items: [{}, {}] } } }),
      readCustomerOrder({ id: "o2", data: { order_id: "AZ2", created_at: new Date(2026, 0, 3), total_price: 5.25, payment_status: "FAILED" } }),
      readCustomerOrder({ id: "o3", data: { order_id: "AZ3", created_at: new Date(2026, 0, 2), total_price: 2.5, payment_status: "CAPTURED" } }),
      readCustomerOrder({ id: "o4", data: {} }),
    ];
    expect(orders[0]).toMatchObject({ id: "o1", orderId: "AZ1", items: 2, total: 10.1255, method: "KNET", paymentStatus: "CAPTURED", orderStatus: "completed" });
    expect(orders[3]).toMatchObject({ orderId: "", items: 0, total: null, date: null });
    expect(isPaidOrder(orders[1])).toBe(false);
    expect(orderTotals(orders)).toEqual({ count: 4, paidCount: 2, paidTotal: 12.626 });
    expect(sortOrdersNewestFirst(orders).map((order) => order.id)).toEqual(["o2", "o3", "o1", "o4"]);
  });

  it("reads membership and points", () => {
    const now = new Date(2026, 5, 1);
    expect(readMembership({ user_memberships: { end_date: new Date(2026, 11, 1) } }, now)).toMatchObject({ active: true });
    expect(readMembership({ user_memberships: { end_date: new Date(2026, 0, 1) } }, now)).toMatchObject({ active: false });
    expect(readMembership({}, now)).toEqual({ active: false, ends: null });
    expect(loyaltyPoints({ user_loyalty: { loyalty_present_point: 40 }, points_balance: 7 })).toBe(40);
    expect(loyaltyPoints({ points_balance: 7 })).toBe(7);
    expect(loyaltyPoints({})).toBe(0);
  });
});

describe("designers", () => {
  const approved = {
    uid: "u-d",
    email: "account@atelier.kw",
    user_role: "Designer",
    photo_url: "https://x/photo.jpg",
    designer_requests: {
      designer_request_id: "DRQ3",
      status: "Approved",
      form_data: { name: "Old Atelier", email: "old@atelier.kw", location: "Kuwait City", experience_in_years: 3, content_category_list: ["Bridal"] },
      designer_sample_designs: [{ sample_image_url: "https://x/a.jpg" }, { sample_file_url: "https://x/b.pdf", file_name: "b.pdf" }],
    },
    designer_main_info: { designer_id: "AZYD8", designer_status: "active", designer_info: { name: "Atelier Noor", location: "Salmiya", experience_in_years: 5, custom_orders: true } },
  };

  it("filters each tab on the request status", () => {
    expect(designerRequestStatusForTab("Active")).toBe("Approved");
    expect(designerTabFilters("Active")).toEqual([
      ["status", "==", "Published"],
      ["designer_requests.status", "==", "Approved"],
    ]);
    expect(designerTabFilters("Rejected")[1][2]).toBe("Rejected");
    expect(designerTabFilters("Pending")[1][2]).toBe("Pending");
  });

  it("uses the Flutter rule for an active designer", () => {
    expect(isActiveDesigner(approved)).toBe(true);
    expect(isActiveDesigner({ ...approved, user_role: "Customer" })).toBe(false);
    expect(inDesignerTab(approved, "Active")).toBe(true);
    expect(inDesignerTab({ designer_requests: { status: "Archived" } }, "Archived")).toBe(true);
    expect(inDesignerTab({ designer_requests: { status: "Rejected" } }, "Active")).toBe(false);
  });

  it("reads the approved copy over the application", () => {
    const designer = readDesigner(approved);
    expect(designer).toMatchObject({
      designerId: "AZYD8",
      uid: "u-d",
      requestId: "DRQ3",
      status: "Approved",
      name: "Atelier Noor",
      email: "old@atelier.kw",
      location: "Salmiya",
      experienceYears: 5,
      styles: ["Bridal"],
      customOrders: true,
      photo: "https://x/photo.jpg",
      sampleCount: 2,
    });
    expect(designerLabel(designer)).toBe("Atelier Noor");
    expect(designerMatchesSearch(designer, "azyd8")).toBe(true);
    expect(designerMatchesSearch(designer, "bridal")).toBe(true);
    expect(designerMatchesSearch(designer, "nope")).toBe(false);
  });

  it("reads a rejected application with its reason", () => {
    const designer = readDesigner({ designer_requests: { status: "Rejected", reject_reason: "Others", reject_message: "Blurry ID", form_data: { name: "Lina" } }, designer_main_info: { designer_info: { name: "Ignored" } } });
    expect(designer).toMatchObject({ status: "Rejected", name: "Lina", rejectReason: "Others", rejectMessage: "Blurry ID", designerId: "" });
    expect(isRejectedDesigner(designer.status)).toBe(true);
  });

  it("reconsiders and archives without touching the role, unlike the Flutter admin", () => {
    const reevaluate = designerReevaluateUpdate("NOW");
    const archive = designerArchiveUpdate("NOW");
    expect(reevaluate).toEqual({
      "designer_requests.status": "Pending",
      "designer_requests.updated_at": "NOW",
      "designer_requests.reject_reason": "",
      "designer_requests.reject_message": "",
    });
    expect(archive).toEqual({ "designer_requests.status": "Archived", "designer_requests.updated_at": "NOW" });
    for (const key of [...Object.keys(reevaluate), ...Object.keys(archive)]) {
      expect(key).not.toBe("user_role");
      expect(key).not.toBe("role_unique_key");
      expect(key.startsWith("designer_requests.")).toBe(true);
    }
  });
});

describe("people readers", () => {
  it("reads untyped values safely", () => {
    expect(record(null)).toEqual({});
    expect(record([1])).toEqual({});
    expect(record({ a: 1 })).toEqual({ a: 1 });
    expect(text("  a ")).toBe("a");
    expect(text(12)).toBe("12");
    expect(text({})).toBe("");
    expect(textList(["a", "", 3, null])).toEqual(["a", "3"]);
    expect(numberOr("4", 1)).toBe(1);
    expect(numberOr(4, 1)).toBe(4);
    expect(timeOf(new Date(5))).toBe(5);
    expect(timeOf(undefined)).toBe(0);
    expect(matchesAny(["Dana", "x@y.kw"], " DAN ")).toBe(true);
    expect(matchesAny(["Dana"], "")).toBe(true);
    expect(isEmail("a@b.kw")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a b@c.kw")).toBe(false);
  });
});
