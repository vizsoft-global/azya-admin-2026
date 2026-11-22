import { describe, expect, it } from "vitest";
import {
  PROFILE_WRITABLE_FIELDS,
  passwordErrorMessage,
  profileUpdate,
  readProfileForm,
  validatePasswordChange,
  validateProfile,
} from "@/features/people/profile";
import {
  assignAlsoPublishes,
  assignRoleUpdate,
  assignableRoles,
  canSignIn,
  deleteRoleBlockedReason,
  groupPermissions,
  keysWithoutRecord,
  mergeStaff,
  nextRoleId,
  readPermission,
  readRole,
  readStaff,
  removeRoleUpdate,
  renameRoleUpdate,
  roleKeyFrom,
  roleRecord,
  sortRoles,
  staffChangeBlockedReason,
  staffCountByRole,
  toggleBlockedReason,
  validateRole,
  type Permission,
  type Role,
} from "@/features/people/roles";

describe("my profile", () => {
  const account = {
    uid: "u1",
    display_name: "Noor",
    phone_number: "+965 5000 0000",
    photo_url: "https://x/old.jpg",
    role_unique_key: "admin",
    status: "Published",
    user_role: "Admin",
  };

  it("reads the three editable fields and nothing else", () => {
    expect(readProfileForm(account)).toEqual({ name: "Noor", phone: "+965 5000 0000", photo: "https://x/old.jpg" });
    expect(readProfileForm(null)).toEqual({ name: "", phone: "", photo: "" });
  });

  it("writes only what changed", () => {
    expect(profileUpdate(account, readProfileForm(account))).toEqual({});
    expect(profileUpdate(account, { name: " Noor A ", phone: "+965 5000 0000", photo: "https://x/old.jpg" })).toEqual({ display_name: "Noor A" });
    expect(profileUpdate(account, { name: "Noor", phone: "", photo: "https://x/new.jpg" })).toEqual({ phone_number: "", photo_url: "https://x/new.jpg" });
  });

  it("can never write the role, the status, the account type or the uid", () => {
    const hostile = { name: "X", phone: "+965 1234 5678", photo: "https://x/p.jpg", role_unique_key: "super_admin", status: "Published", user_role: "SuperAdmin", uid: "other" };
    const update = profileUpdate({ ...account, user_role: "Designer", designer_main_info: { designer_id: "AZYD1" } }, hostile);
    for (const key of Object.keys(update)) expect(PROFILE_WRITABLE_FIELDS as readonly string[]).toContain(key);
    expect(Object.keys(update).sort()).toEqual(["designer_main_info.designer_info.brand_photo", "display_name", "phone_number", "photo_url"]);
    expect(PROFILE_WRITABLE_FIELDS).not.toContain("role_unique_key");
    expect(PROFILE_WRITABLE_FIELDS).not.toContain("status");
    expect(PROFILE_WRITABLE_FIELDS).not.toContain("user_role");
  });

  it("keeps a designer's brand photo in step, and leaves it alone for everyone else", () => {
    const form = { name: "Noor", phone: "+965 5000 0000", photo: "https://x/new.jpg" };
    expect(profileUpdate(account, form)).toEqual({ photo_url: "https://x/new.jpg" });
    expect(profileUpdate({ ...account, user_role: "Designer", designer_main_info: { designer_id: "AZYD1" } }, form)).toEqual({
      photo_url: "https://x/new.jpg",
      "designer_main_info.designer_info.brand_photo": "https://x/new.jpg",
    });
    // A "Designer" account type without designer data gets no half-made designer record.
    expect(profileUpdate({ ...account, user_role: "Designer" }, form)).toEqual({ photo_url: "https://x/new.jpg" });
  });

  it("validates the form", () => {
    expect(validateProfile({ name: "Noor", phone: "", photo: "" })).toEqual({});
    expect(validateProfile({ name: "  ", phone: "", photo: "" }).name).toBeTruthy();
    expect(validateProfile({ name: "N".repeat(51), phone: "", photo: "" }).name).toBeTruthy();
    expect(validateProfile({ name: "Noor", phone: "call me", photo: "" }).phone).toBeTruthy();
    expect(validateProfile({ name: "Noor", phone: "+965 5000-0000", photo: "" }).phone).toBeUndefined();
    expect(validateProfile({ name: "Noor", phone: "", photo: "javascript:alert(1)" }).photo).toBeTruthy();
  });

  it("checks a password change before anything is sent", () => {
    expect(validatePasswordChange({ current: "old-pass-1", next: "new-pass-22", confirm: "new-pass-22" })).toEqual({});
    expect(validatePasswordChange({ current: "", next: "new-pass-22", confirm: "new-pass-22" }).current).toBeTruthy();
    expect(validatePasswordChange({ current: "old", next: "short", confirm: "short" }).next).toBeTruthy();
    expect(validatePasswordChange({ current: "same-pass-1", next: "same-pass-1", confirm: "same-pass-1" }).next).toBeTruthy();
    expect(validatePasswordChange({ current: "old-pass-1", next: "new-pass-22", confirm: "new-pass-23" }).confirm).toBeTruthy();
  });

  it("explains sign-in errors in plain words", () => {
    expect(passwordErrorMessage("auth/wrong-password")).toContain("current password");
    expect(passwordErrorMessage("auth/invalid-credential")).toContain("current password");
    expect(passwordErrorMessage("auth/too-many-requests")).toContain("Wait");
    expect(passwordErrorMessage("something-else")).toContain("not changed");
  });
});

const role = (key: string, extra: Partial<Role> = {}): Role => ({ id: `r-${key}`, roleId: 1, name: key, key, permissions: [], ...extra });
const permission = (id: number, key: string, parentId = 0): Permission => ({ id: `p${id}`, permissionId: id, key, name: key, parentId });

describe("roles", () => {
  it("reads a role record", () => {
    expect(readRole({ id: "a", data: { role_id: 3, role_unique_key: "admin", role_info: { name: "Admin" }, permissions_list: ["order", "", 4, "role"] } })).toEqual({
      id: "a",
      roleId: 3,
      name: "Admin",
      key: "admin",
      permissions: ["order", "4", "role"],
    });
    expect(readRole({ id: "b", data: {} })).toEqual({ id: "b", roleId: 0, name: "", key: "", permissions: [] });
  });

  it("orders roles by their number", () => {
    expect(sortRoles([role("b", { roleId: 2 }), role("a", { roleId: 1 }), role("c", { roleId: 2, name: "A" })]).map((item) => item.key)).toEqual(["a", "c", "b"]);
  });

  it("makes a key from a name and validates both", () => {
    expect(roleKeyFrom("  Store Manager (KW) ")).toBe("store_manager_kw");
    expect(validateRole({ name: "Store manager", key: "store_manager" }, ["admin"])).toEqual({});
    expect(validateRole({ name: "", key: "store_manager" }, []).name).toBeTruthy();
    expect(validateRole({ name: "X", key: "Store Manager" }, []).key).toBeTruthy();
    expect(validateRole({ name: "X", key: "1abc" }, []).key).toBeTruthy();
    expect(validateRole({ name: "X", key: "admin" }, ["admin"]).key).toBeTruthy();
    // Renaming never checks the key: it cannot change.
    expect(validateRole({ name: "Admin", key: "admin" }, ["admin"], { keyLocked: true })).toEqual({});
  });

  it("builds a new role with no permissions and the next number", () => {
    expect(nextRoleId([])).toBe(1);
    expect(nextRoleId([role("a", { roleId: 4 }), role("b", { roleId: 2 })])).toBe(5);
    expect(roleRecord({ name: " Support ", key: "support", roleId: 5, now: "NOW" })).toEqual({
      created_at: "NOW",
      updated_at: "NOW",
      role_info: { name: "Support" },
      role_id: 5,
      role_unique_key: "support",
      permissions_list: [],
    });
    expect(renameRoleUpdate(" Helpdesk ", "NOW")).toEqual({ "role_info.name": "Helpdesk", updated_at: "NOW" });
  });

  it("refuses to delete a role that is protected, held by staff, or your own", () => {
    expect(deleteRoleBlockedReason(role("super_admin"), { staffCount: 0, ownRoleKey: "admin" })).toContain("by name");
    expect(deleteRoleBlockedReason(role("designer"), { staffCount: 0, ownRoleKey: "admin" })).toBeTruthy();
    expect(deleteRoleBlockedReason(role("support"), { staffCount: 2, ownRoleKey: "admin" })).toContain("2 people still hold");
    expect(deleteRoleBlockedReason(role("support"), { staffCount: 1, ownRoleKey: "admin" })).toContain("1 person still holds");
    expect(deleteRoleBlockedReason(role("support"), { staffCount: 0, ownRoleKey: "support" })).toContain("you hold");
    expect(deleteRoleBlockedReason(role("support"), { staffCount: 0, ownRoleKey: "admin" })).toBe("");
  });
});

describe("permissions", () => {
  it("reads a permission record", () => {
    expect(readPermission({ id: "x", data: { permission_id: 12, permission_key: "order", permission_info: { name: "Orders" }, parent_id: 0 } })).toEqual({ id: "x", permissionId: 12, key: "order", name: "Orders", parentId: 0 });
  });

  it("groups children under the permission their parent_id points at", () => {
    const groups = groupPermissions([permission(3, "product_add", 1), permission(1, "product"), permission(2, "order"), permission(4, "product_edit", 1), permission(5, "", 1)]);
    expect(groups.map((group) => [group.parent.key, group.children.map((child) => child.key)])).toEqual([
      ["product", ["product_add", "product_edit"]],
      ["order", []],
    ]);
  });

  it("never hides a permission whose parent is missing or is itself", () => {
    const groups = groupPermissions([permission(1001, "role", 0), permission(1002, "orphan", 5000), permission(7, "self", 7)]);
    expect(groups.map((group) => group.parent.key).sort()).toEqual(["orphan", "role", "self"]);
  });

  it("hangs a grandchild off the top heading", () => {
    const groups = groupPermissions([permission(1, "settings"), permission(2, "settings_payment", 1), permission(3, "settings_payment_keys", 2)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].children.map((child) => child.key)).toEqual(["settings_payment", "settings_payment_keys"]);
  });

  it("lists keys on the role that have no record", () => {
    expect(keysWithoutRecord({ permissions: ["order", "super_admin"] }, [permission(1, "order")])).toEqual(["super_admin"]);
  });

  it("stops people locking themselves out or touching super admin", () => {
    const base = { ownRoleKey: "admin", isSuperAdmin: false };
    expect(toggleBlockedReason({ ...base, role: role("admin"), permissionKey: "role", turnOn: false })).toContain("lock you out");
    expect(toggleBlockedReason({ ...base, role: role("admin"), permissionKey: "role_edit", turnOn: false })).toBeTruthy();
    expect(toggleBlockedReason({ ...base, role: role("admin"), permissionKey: "order", turnOn: false })).toBe("");
    expect(toggleBlockedReason({ ...base, role: role("admin"), permissionKey: "role", turnOn: true })).toBe("");
    expect(toggleBlockedReason({ ...base, role: role("support"), permissionKey: "role", turnOn: false })).toBe("");
    expect(toggleBlockedReason({ ...base, role: role("super_admin"), permissionKey: "order", turnOn: true })).toContain("super admin");
    expect(toggleBlockedReason({ ...base, role: role("support"), permissionKey: "super_admin", turnOn: true })).toContain("super admin");
    expect(toggleBlockedReason({ ownRoleKey: "super_admin", isSuperAdmin: true, role: role("support"), permissionKey: "super_admin", turnOn: true })).toBe("");
    // Even a super admin cannot switch off their own way in.
    expect(toggleBlockedReason({ ownRoleKey: "super_admin", isSuperAdmin: true, role: role("super_admin"), permissionKey: "role", turnOn: false })).toBeTruthy();
  });
});

describe("staff", () => {
  const member = (data: Record<string, unknown>, id = "u1") => readStaff({ id, data });

  it("reads a staff record", () => {
    expect(member({ uid: "u1", display_name: "Sara", email: "s@a.ai", role_unique_key: "admin", status: "Published", user_role: "Admin", photo_url: "https://x" })).toEqual({
      id: "u1",
      uid: "u1",
      name: "Sara",
      email: "s@a.ai",
      photo: "https://x",
      roleKey: "admin",
      status: "Published",
      userRole: "Admin",
    });
    expect(member({ user_name: "sara" }, "doc9").uid).toBe("doc9");
  });

  it("merges lists without repeats, people with a role first", () => {
    const a = member({ display_name: "B", role_unique_key: "admin" }, "1");
    const b = member({ display_name: "A" }, "2");
    const c = member({ display_name: "A", role_unique_key: "support" }, "3");
    expect(mergeStaff([a, b], [b, c]).map((item) => item.id)).toEqual(["3", "1", "2"]);
    expect(staffCountByRole([a, b, c, { ...a, id: "4" }])).toEqual({ admin: 2, support: 1 });
  });

  it("knows who can sign in", () => {
    expect(canSignIn({ status: "Published", roleKey: "admin" }, ["admin"])).toBe(true);
    expect(canSignIn({ status: "Pending", roleKey: "admin" }, ["admin"])).toBe(false);
    expect(canSignIn({ status: "Published", roleKey: "gone" }, ["admin"])).toBe(false);
    expect(canSignIn({ status: "Published", roleKey: "" }, ["admin"])).toBe(false);
  });

  it("offers the right roles", () => {
    const roles = [role("super_admin"), role("admin"), role("designer"), role("")];
    expect(assignableRoles(roles, false).map((item) => item.key)).toEqual(["admin"]);
    expect(assignableRoles(roles, true).map((item) => item.key)).toEqual(["super_admin", "admin"]);
  });

  it("blocks changing yourself, a super admin (unless you are one) and designers", () => {
    const actor = { actorDocId: "me", actorUid: "me-uid", actorIsSuperAdmin: false };
    expect(staffChangeBlockedReason({ ...actor, member: { id: "me", uid: "x", roleKey: "admin" } })).toContain("your own");
    expect(staffChangeBlockedReason({ ...actor, member: { id: "x", uid: "me-uid", roleKey: "admin" } })).toContain("your own");
    expect(staffChangeBlockedReason({ ...actor, member: { id: "x", uid: "y", roleKey: "super_admin" } })).toContain("super admin");
    expect(staffChangeBlockedReason({ ...actor, actorIsSuperAdmin: true, member: { id: "x", uid: "y", roleKey: "super_admin" } })).toBe("");
    expect(staffChangeBlockedReason({ ...actor, member: { id: "x", uid: "y", roleKey: "designer" } })).toContain("designer");
    expect(staffChangeBlockedReason({ ...actor, member: { id: "x", uid: "y", roleKey: "" } })).toBe("");
  });

  it("writes only the role, and publishes only a waiting admin sign-up", () => {
    expect(assignRoleUpdate({ status: "Published", userRole: "Customer" }, " support ")).toEqual({ role_unique_key: "support" });
    expect(assignRoleUpdate({ status: "Secret", userRole: "Customer" }, "support")).toEqual({ role_unique_key: "support" });
    expect(assignAlsoPublishes({ status: "Pending", userRole: "Admin" })).toBe(true);
    expect(assignRoleUpdate({ status: "Pending", userRole: "Admin" }, "support")).toEqual({ role_unique_key: "support", status: "Published" });
    expect(() => assignRoleUpdate({ status: "Published", userRole: "Admin" }, "")).toThrow();
    expect(() => assignRoleUpdate({ status: "Published", userRole: "Admin" }, "designer")).toThrow();
    expect(removeRoleUpdate("DELETE")).toEqual({ role_unique_key: "DELETE" });
  });
});
