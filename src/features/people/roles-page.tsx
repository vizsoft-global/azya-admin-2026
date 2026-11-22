"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDoc, collection, deleteField, doc, getDocs, limit, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { SelectField, TextField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Button, buttonVariants } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { removeDoc, useQueryRows } from "@/lib/firestore-ui";
import { StatusTabs, useStaffOnly } from "./parts";
import {
  ROLES_COLLECTION,
  assignAlsoPublishes,
  assignRoleUpdate,
  assignableRoles,
  canSignIn,
  deleteRoleBlockedReason,
  mergeStaff,
  nextRoleId,
  readRole,
  readStaff,
  removeRoleUpdate,
  renameRoleBlockedReason,
  renameRoleUpdate,
  roleKeyFrom,
  roleLabel,
  roleRecord,
  sortRoles,
  staffChangeBlockedReason,
  staffCountByRole,
  validateRole,
  type Role,
  type RoleForm,
  type StaffMember,
} from "./roles";
import { errorText, isEmail, USERS_COLLECTION } from "./util";

type View = "roles" | "staff";

/** Roles (create, rename, delete, open permissions) and the staff who hold them. */
export function RolesPage() {
  const staffOnly = useStaffOnly();
  const { allowed, scope, roleKey, refreshPermissions } = useAuth();
  const confirm = useConfirm();
  const canEdit = allowed("role_edit");
  const [view, setView] = useState<View>("roles");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Role | null>(null);
  const [assigning, setAssigning] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);

  const roleRows = useQueryRows(ROLES_COLLECTION, { limit: 200 });
  // Everyone who holds a role, plus accounts made on the admin sign-up page that are still waiting for one.
  const withRole = useQueryRows(USERS_COLLECTION, { where: [["role_unique_key", ">", ""]], limit: 500 });
  const signedUp = useQueryRows(USERS_COLLECTION, { where: [["user_role", "==", "Admin"]], limit: 200 });

  const roles = useMemo(() => sortRoles(roleRows.rows.map(readRole)), [roleRows.rows]);
  const staff = useMemo(() => mergeStaff(withRole.rows.map(readStaff), signedUp.rows.map(readStaff)), [withRole.rows, signedUp.rows]);
  const counts = useMemo(() => staffCountByRole(staff), [staff]);
  const roleKeys = useMemo(() => roles.map((role) => role.key).filter(Boolean), [roles]);
  const roleByKey = useMemo(() => new Map(roles.map((role) => [role.key, role])), [roles]);

  if (staffOnly) return staffOnly;

  async function deleteRole(role: Role) {
    const blocked = deleteRoleBlockedReason(role, { staffCount: counts[role.key] ?? 0, ownRoleKey: roleKey });
    if (blocked) {
      toast.error(blocked);
      return;
    }
    const ok = await confirm({
      title: `Delete the role "${roleLabel(role)}"?`,
      description: "The role and its permission list are removed for good. This cannot be undone.",
      confirmLabel: "Delete role",
      destructive: true,
    });
    if (!ok) return;
    try {
      // Checked again on the server: the staff list on screen may not hold every account.
      if (role.key) {
        const holders = await getDocs(query(collection(getFirebase().db, USERS_COLLECTION), where("role_unique_key", "==", role.key), limit(1)));
        if (!holders.empty) throw new Error("someone still holds this role. Move them to another role first");
      }
      await removeDoc(ROLES_COLLECTION, role.id);
      toast.success(`The role "${roleLabel(role)}" was deleted.`);
    } catch (err) {
      toast.error(`The role was not deleted: ${errorText(err)}.`);
    }
  }

  async function removeAccess(member: StaffMember) {
    const blocked = staffChangeBlockedReason({ member, actorDocId: scope.userDocId, actorUid: scope.uid, actorIsSuperAdmin: scope.isSuperAdmin });
    if (blocked) {
      toast.error(blocked);
      return;
    }
    const who = member.name || member.email || "this person";
    const ok = await confirm({
      title: `Remove admin access for ${who}?`,
      description: "Their role is taken off their account and they can no longer sign in to the admin panel. You can give them a role again later.",
      confirmLabel: "Remove access",
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, member.id), removeRoleUpdate(deleteField()));
      toast.success(`${who} no longer has admin access.`);
    } catch (err) {
      toast.error(`Access was not removed: ${errorText(err)}. Nothing was changed.`);
    }
  }

  const roleColumns: Column<Role>[] = [
    { key: "id", header: "ID", className: "w-16 tabular-nums", cell: (role) => role.roleId || "—", sortable: true, sortValue: (role) => role.roleId },
    { key: "name", header: "Name", cell: (role) => <span className="font-medium text-foreground">{roleLabel(role)}</span>, sortable: true, sortValue: roleLabel },
    { key: "key", header: "Key", cell: (role) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{role.key || "—"}</span>, sortable: true, sortValue: (role) => role.key },
    { key: "permissions", header: "Permissions", className: "text-end tabular-nums", cell: (role) => role.permissions.length, sortable: true, sortValue: (role) => role.permissions.length },
    { key: "staff", header: "Staff", className: "text-end tabular-nums", cell: (role) => counts[role.key] ?? 0, sortable: true, sortValue: (role) => counts[role.key] ?? 0 },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (role) => {
        const blocked = deleteRoleBlockedReason(role, { staffCount: counts[role.key] ?? 0, ownRoleKey: roleKey });
        return (
          <span className="flex flex-wrap justify-end gap-1.5">
            <Link href={`/role-permissions?role=${encodeURIComponent(role.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Permissions
            </Link>
            {canEdit ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(renameRoleBlockedReason(role, scope.isSuperAdmin))}
                  title={renameRoleBlockedReason(role, scope.isSuperAdmin) || undefined}
                  onClick={() => setRenaming(role)}
                >
                  Rename
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => void deleteRole(role)}>
                  Delete
                </Button>
              </>
            ) : null}
          </span>
        );
      },
    },
  ];

  const staffColumns: Column<StaffMember>[] = [
    {
      key: "person",
      header: "Person",
      cell: (member) => <UserCell name={member.name} email={member.email} photo={member.photo} subtitle={member.email} fallbackId={member.id} />,
      sortable: true,
      sortValue: (member) => member.name || member.email,
    },
    {
      key: "role",
      header: "Role",
      cell: (member) => {
        if (!member.roleKey) return <span className="text-subtle">No role yet</span>;
        const role = roleByKey.get(member.roleKey);
        return role ? roleLabel(role) : <span className="text-destructive">{member.roleKey} (role not found)</span>;
      },
      sortable: true,
      sortValue: (member) => member.roleKey,
    },
    {
      key: "signin",
      header: "Admin sign-in",
      cell: (member) =>
        canSignIn(member, roleKeys) ? (
          <StatusBadge value="active" label="Can sign in" />
        ) : (
          <StatusBadge value="inactive" label={!member.roleKey ? "Waiting for a role" : member.status !== "Published" ? "Account not published" : "Role not found"} tone={member.roleKey ? "warning" : "neutral"} />
        ),
      sortable: true,
      sortValue: (member) => (canSignIn(member, roleKeys) ? 0 : 1),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (member) => {
        if (!canEdit) return null;
        const blocked = staffChangeBlockedReason({ member, actorDocId: scope.userDocId, actorUid: scope.uid, actorIsSuperAdmin: scope.isSuperAdmin });
        return (
          <span className="flex flex-wrap justify-end gap-1.5">
            <Button variant="outline" size="sm" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => setAssigning(member)}>
              {member.roleKey ? "Change role" : "Give a role"}
            </Button>
            {member.roleKey ? (
              <Button variant="ghost" size="sm" className="text-destructive" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => void removeAccess(member)}>
                Remove access
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        actions={
          canEdit ? (
            view === "roles" ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                New role
              </Button>
            ) : (
              <Button onClick={() => setAdding(true)}>
                <UserPlus aria-hidden />
                Add staff member
              </Button>
            )
          ) : null
        }
      />
      <StatusTabs<View>
        label="Roles and staff"
        value={view}
        onChange={setView}
        tabs={[
          { value: "roles", label: "Roles", count: roleRows.loading && roles.length === 0 ? "…" : String(roles.length) },
          { value: "staff", label: "Staff", count: withRole.loading && staff.length === 0 ? "…" : `${staff.length}${withRole.hasMore ? "+" : ""}` },
        ]}
      />
      {!canEdit ? <p className="text-[12px] text-muted-foreground">You can view roles and staff. Changing them needs the role edit permission.</p> : null}

      {view === "roles" ? (
        <DataTable
          rows={roles}
          columns={roleColumns}
          loading={roleRows.loading}
          error={roleRows.error ? `Roles could not be loaded: ${roleRows.error}` : null}
          emptyMessage="No roles yet. Create the first one to give staff access."
          searchText={(role) => `${role.name} ${role.key}`}
          searchPlaceholder="Search roles"
          noun="role"
        />
      ) : (
        <DataTable
          rows={staff}
          columns={staffColumns}
          loading={withRole.loading}
          error={withRole.error || signedUp.error ? `Staff could not be loaded: ${withRole.error || signedUp.error}` : null}
          emptyMessage="Nobody holds a role yet."
          searchText={(member) => `${member.name} ${member.email} ${member.roleKey}`}
          searchPlaceholder="Search staff by name, email or role"
          pageSize={25}
          hasMore={withRole.hasMore}
          onLoadMore={withRole.loadMore}
          noun="person"
          nounPlural="people"
        />
      )}

      {creating ? <RoleDialog roles={roles} actorIsSuperAdmin={scope.isSuperAdmin} onClose={() => setCreating(false)} /> : null}
      {renaming ? <RoleDialog roles={roles} editing={renaming} actorIsSuperAdmin={scope.isSuperAdmin} onClose={() => setRenaming(null)} /> : null}
      {assigning ? (
        <AssignRoleDialog
          member={assigning}
          roles={assignableRoles(roles, scope.isSuperAdmin)}
          actorIsSuperAdmin={scope.isSuperAdmin}
          onClose={() => setAssigning(null)}
          onSaved={() => void refreshPermissions()}
        />
      ) : null}
      {adding ? (
        <AddStaffDialog
          onClose={() => setAdding(false)}
          onFound={(member) => {
            setAdding(false);
            const blocked = staffChangeBlockedReason({ member, actorDocId: scope.userDocId, actorUid: scope.uid, actorIsSuperAdmin: scope.isSuperAdmin });
            if (blocked) toast.error(blocked);
            else setAssigning(member);
          }}
        />
      ) : null}
    </div>
  );
}

/** Create a role (name and key) or rename one. The key cannot change once the role exists: staff records point at it. */
function RoleDialog({ roles, editing, actorIsSuperAdmin, onClose }: { roles: Role[]; editing?: Role; actorIsSuperAdmin: boolean; onClose: () => void }) {
  const [form, setForm] = useState<RoleForm>({ name: editing?.name ?? "", key: editing?.key ?? "" });
  const [keyTouched, setKeyTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof RoleForm, string>>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const found = validateRole(form, roles.map((role) => role.key), { keyLocked: Boolean(editing) });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const { db } = getFirebase();
    try {
      if (editing) {
        const blocked = renameRoleBlockedReason(editing, actorIsSuperAdmin);
        if (blocked) throw new Error(blocked);
        await updateDoc(doc(db, ROLES_COLLECTION, editing.id), renameRoleUpdate(form.name, serverTimestamp()));
        toast.success(`The role is now called "${form.name.trim()}".`);
      } else {
        const key = form.key.trim();
        const taken = await getDocs(query(collection(db, ROLES_COLLECTION), where("role_unique_key", "==", key), limit(1)));
        if (!taken.empty) {
          setErrors({ key: "Another role already uses this key." });
          return;
        }
        await addDoc(collection(db, ROLES_COLLECTION), roleRecord({ name: form.name, key, roleId: nextRoleId(roles), now: serverTimestamp() }));
        toast.success(`The role "${form.name.trim()}" was created with no permissions. Open Permissions to switch some on.`);
      }
      onClose();
    } catch (err) {
      toast.error(`The role was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? "Rename role" : "New role"}
      description={editing ? "Only the name changes. The key and the permissions stay as they are." : "A role is a named set of permissions. It starts with none."}
      onSubmit={save}
      submitting={saving}
      submitLabel={editing ? "Save name" : "Create role"}
      size="sm"
    >
      <TextField
        label="Name"
        required
        value={form.name}
        maxLength={40}
        onChange={(name) => setForm((cur) => ({ name, key: editing || keyTouched ? cur.key : roleKeyFrom(name) }))}
        placeholder="Store manager"
        error={errors.name}
      />
      <TextField
        label="Key"
        required
        dir="ltr"
        value={form.key}
        maxLength={40}
        disabled={Boolean(editing)}
        onChange={(key) => {
          setKeyTouched(true);
          setForm((cur) => ({ ...cur, key }));
        }}
        placeholder="store_manager"
        error={errors.key}
        hint={editing ? "The key cannot be changed: staff accounts point at it." : "Stored on each staff account. It cannot be changed later."}
      />
    </FormModal>
  );
}

/** Give a role to an account, or move it to another role. */
function AssignRoleDialog({ member, roles, actorIsSuperAdmin, onClose, onSaved }: { member: StaffMember; roles: Role[]; actorIsSuperAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState(roles.some((role) => role.key === member.roleKey) ? member.roleKey : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const who = member.name || member.email || "this person";
  const publishes = assignAlsoPublishes(member);

  async function save() {
    if (!picked) {
      setError("Choose a role.");
      return;
    }
    if (picked === member.roleKey && !publishes) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, member.id), assignRoleUpdate(member, picked, actorIsSuperAdmin));
      const role = roles.find((item) => item.key === picked);
      toast.success(`${who} now has the role "${role ? roleLabel(role) : picked}".`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(`The role was not changed: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={member.roleKey ? "Change role" : "Give a role"}
      description={`${who}${member.email && member.email !== who ? ` (${member.email})` : ""} will be able to open every screen this role allows.`}
      onSubmit={save}
      submitting={saving}
      submitLabel="Save role"
      size="sm"
    >
      <SelectField
        label="Role"
        required
        value={picked}
        onChange={(value) => {
          setPicked(value);
          setError("");
        }}
        options={roles.map((role) => ({ value: role.key, label: roleLabel(role) }))}
        placeholder="Choose a role"
        error={error}
        hint={roles.length === 0 ? "There are no roles to give yet. Create one first." : undefined}
      />
      {publishes ? (
        <p className="rounded-lg bg-muted p-3 text-[12px] text-muted-foreground">
          This account signed up on the admin page and is still waiting. Saving also marks it Published so the person can sign in.
        </p>
      ) : null}
      {!publishes && member.status !== "Published" ? (
        <p className="rounded-lg bg-muted p-3 text-[12px] text-muted-foreground">
          This account is not Published (its status is {member.status || "empty"}), so the person still cannot sign in after this.
        </p>
      ) : null}
    </FormModal>
  );
}

/** Finds an existing account by its email so it can be given a role. Accounts are created by signing up, not here. */
function AddStaffDialog({ onClose, onFound }: { onClose: () => void; onFound: (member: StaffMember) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  async function find() {
    const typed = email.trim();
    if (!isEmail(typed)) {
      setError("Enter the full email address of the account.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const { db } = getFirebase();
      const tries = [...new Set([typed, typed.toLowerCase()])];
      for (const value of tries) {
        const found = await getDocs(query(collection(db, USERS_COLLECTION), where("email", "==", value), limit(1)));
        if (!found.empty) {
          onFound(readStaff({ id: found.docs[0].id, data: found.docs[0].data() }));
          return;
        }
      }
      setError("No account has this email. Ask the person to sign up on the admin sign-up page first, then add them here.");
    } catch (err) {
      setError(`The account could not be looked up: ${errorText(err)}.`);
    } finally {
      setSearching(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add staff member"
      description="Find the person's account by email, then choose their role."
      onSubmit={find}
      submitting={searching}
      submitLabel="Find account"
      size="sm"
    >
      <TextField label="Email" required type="email" dir="ltr" value={email} onChange={setEmail} placeholder="name@azyaa.ai" autoComplete="off" error={error} />
    </FormModal>
  );
}
