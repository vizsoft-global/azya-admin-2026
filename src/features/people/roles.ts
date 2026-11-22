import type { Row } from "@/lib/firestore-ui";
import { numberOr, rawText, record, text, textList } from "./util";
import { tx } from "@/lib/i18n/tx";

/**
 * Roles, permissions and staff, as the Flutter admin stores them.
 *
 * `roles`: `role_id`, `role_unique_key`, `role_info.name`, `permissions_list`
 * (permission keys). `permissions`: `permission_id`, `permission_key`,
 * `permission_info.name`, `parent_id`. A staff member holds a role through
 * `users.role_unique_key`; sign-in needs that role to exist and the account
 * `status` to be `Published`.
 */
export const ROLES_COLLECTION = "roles";
export const PERMISSIONS_COLLECTION = "permissions";

export const SUPER_ADMIN_KEY = "super_admin";
export const DESIGNER_ROLE_KEY = "designer";

/** Role keys the code compares against by name: they cannot be deleted. */
export const PROTECTED_ROLE_KEYS = [SUPER_ADMIN_KEY, "admin", DESIGNER_ROLE_KEY];

/** Permissions that open the roles screens. Nobody can switch these off on the role they hold themselves. */
export const SELF_ACCESS_KEYS = ["role", "role_edit"];

export type Role = { id: string; roleId: number; name: string; key: string; permissions: string[] };

export function readRole(row: Row): Role {
  return {
    id: row.id,
    roleId: numberOr(row.data.role_id, 0),
    name: text(record(row.data.role_info).name),
    key: text(row.data.role_unique_key),
    permissions: textList(row.data.permissions_list),
  };
}

export function roleLabel(role: Pick<Role, "name" | "key">): string {
  return role.name || role.key || tx("Unnamed role");
}

export function sortRoles(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => a.roleId - b.roleId || roleLabel(a).localeCompare(roleLabel(b)));
}

/** "Store Manager" → "store_manager". Keys are lower case letters, digits and underscores. */
export function roleKeyFrom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type RoleForm = { name: string; key: string };

export function validateRole(form: RoleForm, existingKeys: string[], options: { keyLocked?: boolean } = {}): Partial<Record<keyof RoleForm, string>> {
  const errors: Partial<Record<keyof RoleForm, string>> = {};
  const name = form.name.trim();
  if (!name) errors.name = tx("Enter a name for the role.");
  else if (name.length > 40) errors.name = tx("Keep the name under 40 characters.");
  if (options.keyLocked) return errors;
  const key = form.key.trim();
  if (!key) errors.key = tx("Enter a key.");
  else if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) errors.key = tx("Use lower case letters, digits and underscores, starting with a letter.");
  else if (existingKeys.includes(key)) errors.key = tx("Another role already uses this key.");
  return errors;
}

/** Role numbers only order the list, so the next one is simply one past the highest in use. */
export function nextRoleId(roles: Pick<Role, "roleId">[]): number {
  return roles.reduce((max, role) => Math.max(max, role.roleId), 0) + 1;
}

export function roleRecord(input: { name: string; key: string; roleId: number; now: unknown }): Record<string, unknown> {
  return {
    created_at: input.now,
    updated_at: input.now,
    role_info: { name: input.name.trim() },
    role_id: input.roleId,
    role_unique_key: input.key.trim(),
    permissions_list: [],
  };
}

export function renameRoleUpdate(name: string, now: unknown): Record<string, unknown> {
  return { "role_info.name": name.trim(), updated_at: now };
}

/** Why the signed-in person cannot rename this role, or "" when they can. Only a super admin (by role key) may touch the super admin role. */
export function renameRoleBlockedReason(role: Pick<Role, "key">, actorIsSuperAdmin: boolean): string {
  return role.key === SUPER_ADMIN_KEY && !actorIsSuperAdmin ? tx("Only a super admin can change the super admin role.") : "";
}

/** Why this role cannot be deleted, or "" when it can. */
export function deleteRoleBlockedReason(role: Pick<Role, "key">, input: { staffCount: number; ownRoleKey: string }): string {
  if (PROTECTED_ROLE_KEYS.includes(role.key)) return tx("The admin panel relies on this role by name, so it cannot be deleted.");
  if (role.key && role.key === input.ownRoleKey) return tx("This is the role you hold. Ask another admin to delete it.");
  if (input.staffCount > 0) {
    return input.staffCount === 1
      ? tx("1 person still holds this role. Move them to another role first.")
      : tx("{count} people still hold this role. Move them to another role first.", { count: input.staffCount });
  }
  return "";
}

/* ---------- Permissions ---------- */

export type Permission = { id: string; permissionId: number; key: string; name: string; parentId: number };

export function readPermission(row: Row): Permission {
  return {
    id: row.id,
    permissionId: numberOr(row.data.permission_id, 0),
    key: text(row.data.permission_key),
    name: text(record(row.data.permission_info).name),
    parentId: numberOr(row.data.parent_id, 0),
  };
}

export function permissionLabel(permission: Pick<Permission, "name" | "key">): string {
  return permission.name || permission.key;
}

export type PermissionGroup = { parent: Permission; children: Permission[] };

/**
 * A permission sits under another one when its `parent_id` is that one's
 * `permission_id`; everything else is a group heading of its own. Records
 * without a key cannot be switched and are left out.
 */
export function groupPermissions(permissions: Permission[]): PermissionGroup[] {
  const usable = permissions.filter((item) => item.key).sort((a, b) => a.permissionId - b.permissionId || a.key.localeCompare(b.key));
  const byId = new Map<number, Permission>();
  for (const item of usable) if (item.permissionId && !byId.has(item.permissionId)) byId.set(item.permissionId, item);
  const parentOf = (item: Permission) => {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    return parent && parent.id !== item.id ? parent : undefined;
  };
  const groups = new Map<string, PermissionGroup>();
  for (const item of usable) if (!parentOf(item)) groups.set(item.id, { parent: item, children: [] });
  for (const item of usable) {
    const parent = parentOf(item);
    if (!parent) continue;
    // A child of a child hangs off the nearest heading.
    const top = groups.get(parent.id) ?? groups.get(parentOf(parent)?.id ?? "");
    if (top) top.children.push(item);
    else groups.set(item.id, { parent: item, children: [] });
  }
  return [...groups.values()];
}

/** Keys on the role that no permission record describes (for example `super_admin`). */
export function keysWithoutRecord(role: Pick<Role, "permissions">, permissions: Permission[]): string[] {
  const known = new Set(permissions.map((item) => item.key));
  return role.permissions.filter((key) => !known.has(key));
}

/** Why this switch cannot be changed by the signed-in person, or "" when it can. */
export function toggleBlockedReason(input: {
  role: Pick<Role, "key">;
  permissionKey: string;
  turnOn: boolean;
  ownRoleKey: string;
  isSuperAdmin: boolean;
}): string {
  if (input.role.key === SUPER_ADMIN_KEY && !input.isSuperAdmin) return tx("Only a super admin can change the super admin role.");
  if (input.permissionKey === SUPER_ADMIN_KEY && !input.isSuperAdmin) return tx("Only a super admin can give or remove the super admin permission.");
  if (!input.turnOn && input.role.key !== "" && input.role.key === input.ownRoleKey && SELF_ACCESS_KEYS.includes(input.permissionKey)) {
    return tx("You hold this role, and switching this off would lock you out of the roles screens. Ask another admin to do it.");
  }
  return "";
}

/* ---------- Staff ---------- */

export type StaffMember = {
  id: string;
  uid: string;
  name: string;
  email: string;
  photo: string;
  roleKey: string;
  status: string;
  userRole: string;
};

export function readStaff(row: Row): StaffMember {
  return {
    id: row.id,
    uid: text(row.data.uid) || row.id,
    name: text(row.data.display_name) || text(row.data.user_name),
    email: text(row.data.email),
    photo: rawText(row.data.photo_url),
    roleKey: text(row.data.role_unique_key),
    status: text(row.data.status),
    userRole: text(row.data.user_role),
  };
}

/** One list from several queries, without repeats, people with a role first and then by name. */
export function mergeStaff(...lists: StaffMember[][]): StaffMember[] {
  const seen = new Map<string, StaffMember>();
  for (const members of lists) for (const member of members) if (!seen.has(member.id)) seen.set(member.id, member);
  return [...seen.values()].sort(
    (a, b) => Number(Boolean(b.roleKey)) - Number(Boolean(a.roleKey)) || (a.name || a.email).localeCompare(b.name || b.email),
  );
}

export function staffCountByRole(staff: StaffMember[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const member of staff) if (member.roleKey) counts[member.roleKey] = (counts[member.roleKey] ?? 0) + 1;
  return counts;
}

/** A staff account can sign in when it is Published and its role exists. */
export function canSignIn(member: Pick<StaffMember, "status" | "roleKey">, roleKeys: string[]): boolean {
  return member.status === "Published" && member.roleKey !== "" && roleKeys.includes(member.roleKey);
}

/**
 * Roles that can be handed out from the staff list. The designer role is given
 * by approving a designer application, never by hand; only a super admin can
 * make someone else a super admin.
 */
export function assignableRoles(roles: Role[], actorIsSuperAdmin: boolean): Role[] {
  return roles.filter((role) => role.key && role.key !== DESIGNER_ROLE_KEY && (actorIsSuperAdmin || role.key !== SUPER_ADMIN_KEY));
}

/** Why the signed-in person cannot change this member's role, or "" when they can. */
export function staffChangeBlockedReason(input: {
  member: Pick<StaffMember, "id" | "uid" | "roleKey">;
  actorDocId: string;
  actorUid: string;
  actorIsSuperAdmin: boolean;
}): string {
  const { member } = input;
  if ((input.actorDocId && member.id === input.actorDocId) || (input.actorUid && member.uid === input.actorUid)) {
    return tx("You cannot change your own role. Ask another admin.");
  }
  if (member.roleKey === SUPER_ADMIN_KEY && !input.actorIsSuperAdmin) return tx("Only a super admin can change a super admin.");
  if (member.roleKey === DESIGNER_ROLE_KEY) return tx("The designer role comes from the designer approval and is not changed here.");
  return "";
}

/** True when giving this account a role must also publish it: someone who registered on the admin sign-up page and is still Pending. */
export function assignAlsoPublishes(member: Pick<StaffMember, "status" | "userRole">): boolean {
  return member.userRole === "Admin" && member.status !== "Published";
}

export function assignRoleUpdate(member: Pick<StaffMember, "status" | "userRole">, roleKey: string, actorIsSuperAdmin: boolean): Record<string, unknown> {
  const key = roleKey.trim();
  if (!key) throw new Error(tx("Choose a role."));
  if (key === SUPER_ADMIN_KEY && !actorIsSuperAdmin) throw new Error(tx("Only a super admin can make someone a super admin."));
  if (key === DESIGNER_ROLE_KEY) throw new Error(tx("The designer role is given by approving a designer application."));
  return assignAlsoPublishes(member) ? { role_unique_key: key, status: "Published" } : { role_unique_key: key };
}

/** `remove` is Firestore's delete-field marker: the key is taken off the record, as the Flutter admin does. */
export function removeRoleUpdate(remove: unknown): Record<string, unknown> {
  return { role_unique_key: remove };
}
