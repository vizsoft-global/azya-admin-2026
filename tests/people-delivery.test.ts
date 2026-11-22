import { describe, expect, it } from "vitest";
import {
  EMPTY_PARTNER_FORM,
  newPartnerRecord,
  partnerCounts,
  partnerFormOf,
  partnerUpdate,
  readPartner,
  statusUpdate,
  validatePartner,
  withoutPassword,
} from "@/features/people/delivery";

const stored = { id: "7", display_name: "Fast Wheels", email: "ops@fast.kw", status: "active", delivery_status: true, created_at: "T", password: "hunter2" };

describe("delivery partners", () => {
  it("drops every password-like field from a row before the screen sees it", () => {
    const row = withoutPassword({ id: "d1", data: { ...stored, Password: "x", passcode: "1", app_secret: "s", pass: "p" } });
    expect(row.id).toBe("d1");
    expect(Object.keys(row.data).sort()).toEqual(["created_at", "delivery_status", "display_name", "email", "id", "status"]);
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  it("reads a partner without a password on it", () => {
    const partner = readPartner(withoutPassword({ id: "d1", data: stored }));
    expect(partner).toEqual({ id: "d1", number: "7", name: "Fast Wheels", email: "ops@fast.kw", status: "active", onDelivery: true, createdAt: "T" });
    expect(Object.keys(readPartner({ id: "d1", data: stored }))).not.toContain("password");
  });

  it("counts by status and availability", () => {
    const partners = [
      readPartner({ id: "1", data: { status: "active", delivery_status: true } }),
      readPartner({ id: "2", data: { status: "active" } }),
      readPartner({ id: "3", data: { status: "archived" } }),
      readPartner({ id: "4", data: { status: "Published" } }),
    ];
    expect(partnerCounts(partners)).toEqual({ total: 4, active: 2, archived: 2, onDelivery: 1 });
  });

  it("validates name, email, duplicates and status", () => {
    const others = [{ id: "1", email: "Ops@Fast.kw" }];
    expect(validatePartner({ name: "A", email: "new@fast.kw", status: "active" }, others)).toEqual({});
    expect(validatePartner(EMPTY_PARTNER_FORM, others)).toMatchObject({ name: expect.any(String), email: expect.any(String) });
    expect(validatePartner({ name: "A", email: "not-an-email", status: "active" }, others).email).toBeTruthy();
    expect(validatePartner({ name: "A", email: " ops@fast.kw ", status: "active" }, others).email).toContain("already");
    // Editing the same partner is not a duplicate of itself.
    expect(validatePartner({ name: "A", email: "ops@fast.kw", status: "active" }, others, "1")).toEqual({});
    expect(validatePartner({ name: "A", email: "a@b.kw", status: "Published" }, others).status).toBeTruthy();
  });

  it("creates a record with the Flutter fields and no password", () => {
    const record = newPartnerRecord({ name: " Fast Wheels ", email: " Ops@Fast.KW ", status: "active" }, 12, "NOW");
    expect(record).toEqual({ status: "active", created_at: "NOW", email: "ops@fast.kw", delivery_status: false, display_name: "Fast Wheels", id: "12" });
    expect(Object.keys(record)).not.toContain("password");
  });

  it("updates only name, email and status, and only when they changed", () => {
    const partner = readPartner({ id: "d1", data: stored });
    expect(partnerFormOf(partner)).toEqual({ name: "Fast Wheels", email: "ops@fast.kw", status: "active" });
    expect(partnerUpdate(partner, partnerFormOf(partner))).toEqual({});
    expect(partnerUpdate(partner, { name: "Faster Wheels", email: "OPS@fast.kw", status: "archived" })).toEqual({ display_name: "Faster Wheels", status: "archived" });
    expect(statusUpdate("archived")).toEqual({ status: "archived" });
    for (const key of Object.keys(partnerUpdate(partner, { name: "x", email: "y@z.kw", status: "archived" }))) expect(["display_name", "email", "status"]).toContain(key);
  });
});
