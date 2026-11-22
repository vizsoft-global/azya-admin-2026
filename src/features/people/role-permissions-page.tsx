"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { arrayRemove, arrayUnion, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { SelectField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { Switch } from "@/components/ui/switch";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows } from "@/lib/firestore-ui";
import { BackLink, Section, useStaffOnly } from "./parts";
import {
  PERMISSIONS_COLLECTION,
  ROLES_COLLECTION,
  SUPER_ADMIN_KEY,
  groupPermissions,
  keysWithoutRecord,
  permissionLabel,
  readPermission,
  readRole,
  roleLabel,
  sortRoles,
  toggleBlockedReason,
  type Permission,
  type Role,
} from "./roles";
import { errorText } from "./util";
import { tx } from "@/lib/i18n/tx";

/**
 * Permission switches for one role (`?role=<roles document id>`). Each switch
 * adds or removes one key in the role's `permissions_list`, exactly as the
 * Flutter admin does, so two admins editing at once cannot overwrite each other.
 */
export function RolePermissionsPage() {
  const staffOnly = useStaffOnly();
  const router = useRouter();
  const roleId = useSearchParams().get("role") ?? "";
  const { allowed, roleKey, scope, refreshPermissions } = useAuth();
  const canEdit = allowed("role_edit");
  const [busyKey, setBusyKey] = useState("");

  const roleRows = useQueryRows(ROLES_COLLECTION, { limit: 200 });
  const permissionRows = useQueryRows(PERMISSIONS_COLLECTION, { limit: 500 });
  const roles = useMemo(() => sortRoles(roleRows.rows.map(readRole)), [roleRows.rows]);
  const permissions = useMemo(() => permissionRows.rows.map(readPermission), [permissionRows.rows]);
  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const role = roles.find((item) => item.id === roleId) ?? null;

  if (staffOnly) return staffOnly;
  if (roleRows.error || permissionRows.error) {
    return <EmptyState icon={ShieldCheck} title={tx("Permissions could not be loaded")} description={tx("{error} Reload the page to try again.", { error: roleRows.error || permissionRows.error })} />;
  }
  if (roleRows.loading && roles.length === 0) return <PageLoading label={tx("Loading roles…")} />;

  const picker = (
    <SelectField
      label={tx("Role")}
      value={role?.id ?? ""}
      onChange={(id) => router.replace(`/role-permissions?role=${encodeURIComponent(id)}`)}
      options={roles.map((item) => ({ value: item.id, label: roleLabel(item) }))}
      placeholder={tx("Choose a role")}
      className="w-full sm:max-w-xs"
    />
  );

  if (!role) {
    return (
      <div className="space-y-3">
        <Section title={roleId ? tx("That role was not found") : tx("Choose a role")} description={tx("Pick the role whose permissions you want to see or change.")}>
          {roles.length > 0 ? picker : <p className="text-[13px] text-muted-foreground">{tx("There are no roles yet. Create one on the Roles screen.")}</p>}
        </Section>
        <BackLink href="/roles">{tx("All roles")}</BackLink>
      </div>
    );
  }

  async function toggle(permission: Permission, turnOn: boolean, current: Role) {
    const blocked = toggleBlockedReason({ role: current, permissionKey: permission.key, turnOn, ownRoleKey: roleKey, isSuperAdmin: scope.isSuperAdmin });
    if (blocked) {
      toast.error(blocked);
      return;
    }
    setBusyKey(permission.key);
    try {
      await updateDoc(doc(getFirebase().db, ROLES_COLLECTION, current.id), {
        permissions_list: turnOn ? arrayUnion(permission.key) : arrayRemove(permission.key),
        updated_at: serverTimestamp(),
      });
      toast.success(turnOn ? tx("{permission} switched on for {role}.", { permission: permissionLabel(permission), role: roleLabel(current) }) : tx("{permission} switched off for {role}.", { permission: permissionLabel(permission), role: roleLabel(current) }));
      // Changing the role you hold changes what you can open, so reload your own permissions.
      if (current.key && current.key === roleKey) await refreshPermissions();
    } catch (err) {
      toast.error(tx("{permission} was not changed: {reason}. The role is as it was.", { permission: permissionLabel(permission), reason: errorText(err) }));
    } finally {
      setBusyKey("");
    }
  }

  const extraKeys = keysWithoutRecord(role, permissions);
  // One message for the whole page instead of the same note under every switch.
  const roleLocked = role.key === SUPER_ADMIN_KEY && !scope.isSuperAdmin;
  const on = new Set(role.permissions);
  const row = (permission: Permission, child: boolean) => {
    const blocked = toggleBlockedReason({ role, permissionKey: permission.key, turnOn: !on.has(permission.key), ownRoleKey: roleKey, isSuperAdmin: scope.isSuperAdmin });
    return (
      <PermissionSwitch
        key={permission.id}
        permission={permission}
        checked={on.has(permission.key)}
        child={child}
        disabled={!canEdit || busyKey !== "" || Boolean(blocked)}
        note={canEdit && !roleLocked ? blocked : ""}
        onChange={(next) => void toggle(permission, next, role)}
      />
    );
  };

  return (
    <div className="space-y-3">
      <Section
        title={tx("{role} access", { role: roleLabel(role) })}
        description={
          roleLocked
            ? tx("Only a super admin can change the super admin role.")
            : canEdit
            ? tx("Each switch is saved as soon as you change it. {on} of {all} permissions are on.", { on: role.permissions.length, all: permissions.filter((item) => item.key).length })
            : 'You can view this role. Changing it needs the "role edit" permission.'
        }
        actions={<BackLink href="/roles">{tx("All roles")}</BackLink>}
      >
        {picker}
      </Section>

      {permissionRows.loading && permissions.length === 0 ? <PageLoading label={tx("Loading permissions…")} /> : null}
      {!permissionRows.loading && groups.length === 0 ? <EmptyState icon={ShieldCheck} title={tx("No permissions are set up")} description={tx("The permissions list is empty, so there is nothing to switch on.")} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <section key={group.parent.id} className="rounded-[14px] bg-card p-3">
            {row(group.parent, false)}
            {group.children.length > 0 ? <div className="mt-1 border-t border-border pt-1">{group.children.map((child) => row(child, true))}</div> : null}
          </section>
        ))}
      </div>

      {extraKeys.length > 0 ? (
        <Section title={tx("Other keys on this role")} description={tx("These are on the role but have no permission record, so they have no switch. They stay as they are.")}>
          <p className="font-mono text-[12px] break-words text-muted-foreground" dir="ltr" lang="en">
            {extraKeys.join(", ")}
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function PermissionSwitch({
  permission,
  checked,
  child,
  disabled,
  note,
  onChange,
}: {
  permission: Permission;
  checked: boolean;
  child: boolean;
  disabled: boolean;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${child ? "ps-3" : ""}`}>
      <label htmlFor={id} className="min-w-0">
        <span className={`block truncate text-[13px] ${child ? "text-foreground" : "font-semibold text-heading"}`}>{permissionLabel(permission)}</span>
        <span className="block truncate font-mono text-[11px] text-subtle" dir="ltr" lang="en">
          {permission.key}
        </span>
        {note ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{note}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={checked ? tx("{permission}: on", { permission: permissionLabel(permission) }) : tx("{permission}: off", { permission: permissionLabel(permission) })} />
    </div>
  );
}
