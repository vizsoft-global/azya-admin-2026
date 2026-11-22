"use client";

import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  limit,
} from "firebase/firestore";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getFirebase } from "@/lib/firebase";
import type { Lang } from "@/lib/i18n";
import { scopeOf, type RoleScope } from "@/lib/role-scope";

type Profile = Record<string, unknown> & { id: string };

type AuthValue = {
  user: User | null;
  profile: Profile | null;
  permissions: string[];
  loading: boolean;
  lang: Lang;
  setLang: (lang: Lang) => void;
  login: (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string, name: string) => Promise<string | null>;
  reset: (email: string) => Promise<string | null>;
  logout: () => Promise<void>;
  allowed: (permission?: string) => boolean;
  /** Firebase Auth uid of the signed-in person, or "". */
  uid: string;
  /** `users.role_unique_key` of the signed-in person, or "". */
  roleKey: string;
  /** Who is signed in, for "designers see only their own records". */
  scope: RoleScope;
  /** Reloads the signed-in person's record and their role's permissions (after editing either). */
  refreshPermissions: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function loadProfile(uid: string) {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, "users"), where("uid", "==", uid), limit(1)));
  if (snap.empty) return null;
  const item = snap.docs[0];
  return { id: item.id, ...item.data() } as Profile;
}

/** The role's permission keys, or null when no role has that key. */
async function loadPermissions(roleKey: string) {
  if (!roleKey) return null;
  const { db } = getFirebase();
  const snap = await getDocs(
    query(collection(db, "roles"), where("role_unique_key", "==", roleKey), limit(1)),
  );
  if (snap.empty) return null;
  const list = snap.docs[0].data().permissions_list;
  return Array.isArray(list) ? list.map(String) : [];
}

/**
 * The same gate as sign-in, applied every time a session is restored: the account
 * must still be Published and its role must still exist. Returns the permissions,
 * or the reason the account may not use the panel.
 */
async function loadAccess(uid: string): Promise<{ profile: Profile; permissions: string[] } | { denied: "no-record" | "not-published" | "no-role" }> {
  const profile = await loadProfile(uid);
  if (!profile) return { denied: "no-record" };
  if (String(profile.status ?? "") !== "Published") return { denied: "not-published" };
  const permissions = await loadPermissions(String(profile.role_unique_key ?? ""));
  if (!permissions) return { denied: "no-role" };
  return { profile, permissions };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem("azya-lang");
    if (stored === "ar" || stored === "en") setLangState(stored);
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    window.localStorage.setItem("azya-lang", next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  }

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, async (next) => {
      if (!next) {
        setUser(null);
        setProfile(null);
        setPermissions([]);
        setLoading(false);
        return;
      }
      const access = await loadAccess(next.uid);
      if ("denied" in access) {
        // An account that was unpublished or lost its role is treated as signed out.
        // A brand-new account has no record yet while Register is still writing it,
        // so that case is left for Register to sign out itself.
        setUser(null);
        setProfile(null);
        setPermissions([]);
        setLoading(false);
        if (access.denied !== "no-record") await signOut(auth).catch(() => undefined);
        return;
      }
      setUser(next);
      setProfile(access.profile);
      setPermissions(access.permissions);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      permissions,
      loading,
      lang,
      setLang,
      uid: user?.uid ?? "",
      roleKey: String(profile?.role_unique_key ?? ""),
      scope: scopeOf(profile, user?.uid ?? "", permissions),
      allowed(permission) {
        if (!permission) return true;
        // A super admin opens every page, as in the Flutter admin: by role key, or by the permission.
        if (profile?.role_unique_key === "super_admin" || permissions.includes("super_admin")) return true;
        return permissions.includes(permission);
      },
      async refreshPermissions() {
        const current = getFirebase().auth.currentUser;
        if (!current) return;
        const access = await loadAccess(current.uid);
        if ("denied" in access) {
          setUser(null);
          setProfile(null);
          setPermissions([]);
          await signOut(getFirebase().auth).catch(() => undefined);
          return;
        }
        setProfile(access.profile);
        setPermissions(access.permissions);
      },
      async login(email, password) {
        const { auth, db } = getFirebase();
        await signInWithEmailAndPassword(auth, email.trim(), password);
        const loaded = await loadProfile(auth.currentUser!.uid);
        if (!loaded) {
          await signOut(auth);
          return "No users document for this account.";
        }
        if (String(loaded.status ?? "") !== "Published") {
          await signOut(auth);
          return "Account is not Published.";
        }
        const roleKey = String(loaded.role_unique_key ?? "");
        if (!roleKey) {
          await signOut(auth);
          return "No role is assigned to this account.";
        }
        const roleSnap = await getDocs(
          query(collection(db, "roles"), where("role_unique_key", "==", roleKey), limit(1)),
        );
        if (roleSnap.empty) {
          await signOut(auth);
          return "Role was not found.";
        }
        return null;
      },
      async register(email, password, name) {
        const { auth, db } = getFirebase();
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await setDoc(doc(db, "users", cred.user.uid), {
          email: email.trim(),
          uid: cred.user.uid,
          display_name: name,
          user_name: name,
          status: "Pending",
          user_role: "Admin",
          created_time: new Date(),
          role_unique_key: "",
        });
        await signOut(auth);
        return null;
      },
      async reset(email) {
        await sendPasswordResetEmail(getFirebase().auth, email.trim());
        return null;
      },
      async logout() {
        await signOut(getFirebase().auth);
      },
    }),
    [user, profile, permissions, loading, lang],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
