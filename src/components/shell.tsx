"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { ShellFrame, type ShellCrumb, type ShellPageHit } from "./layout/shell-frame";
import { adminRoutes, routeByPath } from "@/lib/routes";
import { allSections, leafFor, mainNav, secondaryNav, sectionLabelFor, settingsNav, type NavSection } from "@/lib/nav";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const VERSION = !BUILD_ID || BUILD_ID.startsWith("local-") ? "dev" : BUILD_ID.slice(0, 7);

/** The signed-in panel: the shell frame fed from the route table, the sidebar config and the user's permissions. */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname.replace(/^\/+|\/+$/g, "");
  const route = routeByPath(active);
  const { allowed, profile, lang, setLang, logout } = useAuth();

  const canOpen = useCallback(
    (path: string) => {
      const target = routeByPath(path);
      return Boolean(target) && (!target!.permission || allowed(target!.permission));
    },
    [allowed],
  );

  // Sections and links the user has no permission for are left out; a section with nothing left disappears.
  const nav = useMemo(() => {
    const visible = (sections: NavSection[]) =>
      sections
        .map((section) => ({
          ...section,
          tabs: section.tabs?.filter(canOpen),
          children: section.children?.map((child) => ({ ...child, tabs: child.tabs.filter(canOpen) })).filter((child) => child.tabs.length > 0),
        }))
        .filter((section) => (section.children ? section.children.length > 0 : (section.tabs?.length ?? 0) > 0));
    return { main: visible(mainNav), secondary: visible(secondaryNav), settings: visible([settingsNav]) };
  }, [canOpen]);

  const leaf = leafFor(active);
  const tabs = (leaf?.tabs ?? []).filter(canOpen).map((path) => ({ path, label: routeByPath(path)?.title ?? path }));

  // Pages reached from a button or a row (not a tab) get a trail back to their list.
  const crumbs = useMemo<ShellCrumb[]>(() => {
    if (!leaf?.hidden?.includes(active)) return [];
    const section = allSections.find((item) => (item.children ?? []).includes(leaf));
    const home = leaf.tabs.find(canOpen);
    return [
      ...(section && section.label !== leaf.label ? [{ label: section.label }] : []),
      { label: leaf.label, path: home },
      { label: route?.title ?? active },
    ];
  }, [leaf, active, route, canOpen]);

  const searchPages = useCallback(
    (term: string): ShellPageHit[] => {
      const needle = term.trim().toLowerCase();
      return adminRoutes
        .filter((item) => item.path !== "error404" && canOpen(item.path))
        .map((item) => ({ route: item, menu: sectionLabelFor(item.path) }))
        .filter(({ route: item, menu }) => `${item.title} ${item.path} ${item.group} ${menu}`.toLowerCase().includes(needle))
        .slice(0, 20)
        .map(({ route: item, menu }) => ({ path: item.path, title: item.title, menu: menu || item.group }));
    },
    [canOpen],
  );

  return (
    <ShellFrame
      nav={nav}
      active={active}
      title={route?.title ?? "Not found"}
      tabs={tabs}
      crumbs={crumbs}
      profile={{
        name: String(profile?.display_name ?? profile?.user_name ?? profile?.email ?? "Admin"),
        role: String(profile?.role_unique_key ?? profile?.user_role ?? ""),
        photo: typeof profile?.photo_url === "string" ? profile.photo_url : "",
      }}
      lang={lang}
      onLang={setLang}
      onLogout={() => void logout()}
      searchPages={searchPages}
      version={VERSION}
    >
      {children}
    </ShellFrame>
  );
}
