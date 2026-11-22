"use client";

import { useAuth } from "@/components/auth-provider";

/** Who is signed in: uid, role key, and whether they are a designer or a super admin. */
export function useRoleScope() {
  return useAuth().scope;
}
