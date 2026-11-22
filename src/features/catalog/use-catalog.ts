"use client";

import { useMemo } from "react";
import { useQueryRows, type Row, type WhereClause } from "@/lib/firestore-ui";
import { useRoleScope } from "@/lib/use-role-scope";
import { slimDesigner } from "./product-list";
import { strList } from "./product-model";

/** Designers, slimmed. A signed-in designer gets only their own record. */
export function useDesigners(enabled = true) {
  const scope = useRoleScope();
  const where: WhereClause[] = scope.isDesigner ? [["uid", "==", scope.uid]] : [["user_role", "==", "Designer"]];
  return useQueryRows("users", { where, limit: 500, enabled: enabled && (!scope.isDesigner || scope.uid !== "") }, slimDesigner);
}

/** Approving and rejecting products is for super admins: the role, or the Flutter admin's `user_role` of SuperAdmin. */
export function useCanReview() {
  const scope = useRoleScope();
  return scope.isSuperAdmin || scope.userRole === "SuperAdmin";
}

/** Document ids of the records whose list field holds this product's id. */
export function useMembership(rows: Row[], listField: string, productCode: string) {
  return useMemo(() => (productCode ? rows.filter((row) => strList(row.data[listField]).includes(productCode)).map((row) => row.id) : []), [rows, listField, productCode]);
}
