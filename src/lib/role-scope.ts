/**
 * Who is signed in, for the "designers see only their own records" rule the
 * Flutter admin applies. The check runs in the browser only: database rules do
 * not enforce it, so it limits what the screens show, not what an account can read.
 */
export type RoleScope = {
  /** Firebase Auth uid; records carry it as `designer_uid`, `product_designer_id`, `image_uid`. */
  uid: string;
  /** `users.role_unique_key`, e.g. "super_admin" or "designer". */
  roleKey: string;
  /** `users.user_role`, e.g. "SuperAdmin", "Designer", "Admin". */
  userRole: string;
  isDesigner: boolean;
  isSuperAdmin: boolean;
  displayName: string;
  email: string;
  /** Document id of the signed-in user's `users` record. */
  userDocId: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function scopeOf(profile: Record<string, unknown> | null | undefined, uid: string): RoleScope {
  const roleKey = text(profile?.role_unique_key);
  const userRole = text(profile?.user_role);
  return {
    uid,
    roleKey,
    userRole,
    isDesigner: roleKey === "designer",
    // Only the role key makes a super admin. A "super_admin" permission on another role is an
    // ordinary permission (in the Flutter admin it only opened the inventory decisions).
    isSuperAdmin: roleKey === "super_admin",
    displayName: text(profile?.display_name) || text(profile?.user_name),
    email: text(profile?.email),
    userDocId: text(profile?.id),
  };
}

/** True when a record owned by `ownerUid` may be shown: always for staff, only their own for a designer. */
export function ownedInScope(scope: RoleScope, ownerUid: unknown) {
  return !scope.isDesigner || (scope.uid !== "" && ownerUid === scope.uid);
}

type Line = { product_designer_id?: unknown };

/** An order line belongs to a designer when `product_designer_id` is their uid. */
export function lineInScope(scope: RoleScope, line: Line | null | undefined) {
  return ownedInScope(scope, line?.product_designer_id);
}

/** The lines of an order (`order_items.cart_items[]`) the signed-in person may see. */
export function orderLinesInScope<T extends Line>(scope: RoleScope, order: Record<string, unknown> | null | undefined): T[] {
  const items = (order?.order_items as { cart_items?: unknown } | undefined)?.cart_items;
  const lines = Array.isArray(items) ? (items as T[]) : [];
  return scope.isDesigner ? lines.filter((line) => lineInScope(scope, line)) : lines;
}

/** A designer sees an order only when at least one of its lines is theirs. */
export function orderInScope(scope: RoleScope, order: Record<string, unknown> | null | undefined) {
  return !scope.isDesigner || orderLinesInScope(scope, order).length > 0;
}
