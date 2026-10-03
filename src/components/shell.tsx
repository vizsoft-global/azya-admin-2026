"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Languages, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, UserRound } from "lucide-react";
import { useAuth } from "./auth-provider";
import { HeaderSlotContext, type SlotTargets } from "./header-slots";
import { adminRoutes, routeByPath } from "@/lib/routes";
import { leafFor, mainNav, secondaryNav, sectionLabelFor, settingsNav, type NavLeaf, type NavSection } from "@/lib/nav";

const COLLAPSE_KEY = "azya.sidebar.collapsed";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const inLeaf = (leaf: NavLeaf, path: string) => leaf.tabs.includes(path) || Boolean(leaf.hidden?.includes(path));

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname.replace(/^\/+/, "");
  const route = routeByPath(active);
  const { allowed } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [hover, setHover] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [slots, setSlots] = useState<SlotTargets>({ center: null, actions: null });
  const centerRef = useCallback((el: HTMLDivElement | null) => setSlots((cur) => (cur.center === el ? cur : { ...cur, center: el })), []);
  const actionsRef = useCallback((el: HTMLDivElement | null) => setSlots((cur) => (cur.actions === el ? cur : { ...cur, actions: el })), []);

  useEffect(() => setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1"), []);
  useEffect(() => setMobileOpen(false), [pathname]);

  function toggleCollapsed() {
    setCollapsed((cur) => {
      window.localStorage.setItem(COLLAPSE_KEY, cur ? "0" : "1");
      return !cur;
    });
    setHover(false);
  }

  const canOpen = (path: string) => {
    const target = routeByPath(path);
    return Boolean(target) && (!target!.permission || allowed(target!.permission));
  };
  const leaf = leafFor(active);
  const tabs = (leaf?.tabs ?? []).filter(canOpen);
  const showTabs = tabs.length > 1 && tabs.includes(active);
  const expanded = !collapsed || hover;

  return (
    <div className="h-svh overflow-hidden bg-[#ebebeb] p-[5px] text-[#303030]">
      <div className="flex h-full min-h-0 gap-[5px]">
        {mobileOpen && <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside
          className={cx(
            "z-40 h-full shrink-0 flex-col rounded-[12px] bg-[#fcfcfc] py-4 transition-[width] duration-200",
            expanded ? "w-[168px] px-2" : "w-[60px] px-1",
            mobileOpen ? "fixed inset-y-[5px] start-[5px] flex shadow-xl" : "hidden md:flex",
          )}
          onMouseEnter={() => collapsed && setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <Sidebar active={active} expanded={expanded} collapsed={collapsed} onToggle={toggleCollapsed} canOpen={canOpen} />
        </aside>
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[14px] border border-[#e6e7e4] bg-[#f1f1f1] px-5 py-3">
          <div className="mx-auto w-full max-w-[1480px]">
            <header className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 pb-3">
              <button type="button" onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-[#757575] hover:bg-white md:hidden" aria-label="Open menu">
                <Menu className="size-4" />
              </button>
              <div className="min-w-0 shrink-0">
                {showTabs ? (
                  <nav className="flex flex-wrap items-center gap-1">
                    {tabs.map((path) => (
                      <Link
                        key={path}
                        href={`/${path}`}
                        className={cx(
                          "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                          path === active ? "bg-white font-medium text-[#1a1a1a] shadow-sm" : "text-[#888] hover:text-[#1a1a1a]",
                        )}
                      >
                        {routeByPath(path)?.title ?? path}
                      </Link>
                    ))}
                  </nav>
                ) : (
                  <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#2f2f2f]">{route?.title ?? "Not found"}</h1>
                )}
              </div>
              <div
                ref={centerRef}
                className="flex min-w-[160px] flex-1 justify-center empty:hidden"
              />
              <div
                ref={actionsRef}
                className="ms-auto flex shrink-0 flex-wrap items-center gap-2 empty:hidden"
              />
            </header>
            <HeaderSlotContext.Provider value={slots}>{children}</HeaderSlotContext.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  active,
  expanded,
  collapsed,
  onToggle,
  canOpen,
}: {
  active: string;
  expanded: boolean;
  collapsed: boolean;
  onToggle: () => void;
  canOpen: (path: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = (sections: NavSection[]) =>
    sections
      .map((section) => ({
        ...section,
        tabs: section.tabs?.filter(canOpen),
        children: section.children
          ?.map((child) => ({ ...child, tabs: child.tabs.filter(canOpen) }))
          .filter((child) => child.tabs.length > 0),
      }))
      .filter((section) => (section.children ? section.children.length > 0 : (section.tabs?.length ?? 0) > 0));

  const main = visible(mainNav);
  const secondary = visible(secondaryNav);
  const settings = visible([settingsNav]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className={cx("mb-3 flex min-w-0", expanded ? "items-center gap-2 px-1" : "flex-col items-center gap-2")}>
        <span className="grid size-[26px] shrink-0 place-items-center rounded-[6px] bg-[#c6f54a] text-[15px] font-bold leading-none text-[#111]">✱</span>
        {expanded && <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-[#2f2f2f]">azyaa</span>}
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden rounded-md p-1 text-[#8a8a8a] hover:bg-[#f3f3f3] hover:text-[#2f2f2f] md:block"
        >
          {collapsed ? <PanelLeftOpen className="size-3.5 rtl:rotate-180" /> : <PanelLeftClose className="size-3.5 rtl:rotate-180" />}
        </button>
      </div>

      {expanded && (
        <label className="mb-3 flex h-[30px] items-center gap-2 rounded-full bg-white px-3 text-[12px] ring-1 ring-[#eee]">
          <Search className="size-3.5 shrink-0 text-[#8a8a8a]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search… ⌘K"
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[#bbb]"
          />
        </label>
      )}

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {expanded && q.trim() ? (
          <PageSearch q={q} canOpen={canOpen} onPick={() => setQ("")} />
        ) : (
          <>
            {main.map((section) => (
              <SectionItem key={section.label} section={section} active={active} expanded={expanded} />
            ))}
            <div className="my-2" />
            {secondary.map((section) => (
              <SectionItem key={section.label} section={section} active={active} expanded={expanded} />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 pt-2">
        {settings.map((section) => (
          <SectionItem key={section.label} section={section} active={active} expanded={expanded} />
        ))}
        <ProfileMenu expanded={expanded} />
      </div>
    </>
  );
}

const rowClass = (on: boolean, expanded: boolean) =>
  cx(
    "flex w-full min-w-0 items-center gap-2 rounded-[8px] py-1.5 text-start text-[13px] text-[#303030] transition-colors",
    expanded ? "px-[7px]" : "justify-center px-0",
    on ? "bg-[#f1f1f1] font-medium" : "hover:bg-[#f6f6f6]",
  );

function SectionItem({ section, active, expanded }: { section: NavSection; active: string; expanded: boolean }) {
  const router = useRouter();
  const Icon = section.icon;
  const children = section.children;
  const containsActive = children
    ? children.some((child) => inLeaf(child, active))
    : Boolean(section.tabs?.includes(active));
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  if (!children) {
    const href = `/${section.tabs![0]}`;
    return (
      <Link href={href} title={expanded ? undefined : section.label} className={rowClass(containsActive, expanded)}>
        <Icon className="size-4 shrink-0" strokeWidth={1.6} />
        {expanded && <span className="truncate">{section.label}</span>}
      </Link>
    );
  }

  const first = `/${children[0].tabs[0]}`;
  return (
    <div>
      <button
        type="button"
        title={expanded ? undefined : section.label}
        className={rowClass(containsActive && !expanded, expanded)}
        onClick={() => {
          if (!expanded || !open) {
            setOpen(true);
            if (!containsActive) router.push(first);
            return;
          }
          setOpen(false);
        }}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.6} />
        {expanded && <span className={cx("flex-1 truncate", containsActive && "font-medium")}>{section.label}</span>}
      </button>
      {expanded && open && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {children.map((child) => (
            <ChildLink key={child.label} leaf={child} on={inLeaf(child, active)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildLink({ leaf, on }: { leaf: NavLeaf; on: boolean }) {
  return (
    <Link
      href={`/${leaf.tabs[0]}`}
      className={cx(
        "relative flex min-w-0 items-center rounded-[8px] py-1.5 ps-[30px] pe-2 text-[13px] transition-colors",
        on ? "bg-[#f1f1f1] font-medium text-[#303030]" : "text-[#8a8a8a] hover:bg-[#f6f6f6] hover:text-[#303030]",
      )}
    >
      {on && (
        <svg className="absolute start-[12px] top-[3px] rtl:-scale-x-100" width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
          <path d="M1 0v7a4 4 0 0 0 4 4h6" stroke="#b5b5b5" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      <span className="truncate" title={leaf.label}>{leaf.label}</span>
    </Link>
  );
}

function PageSearch({ q, canOpen, onPick }: { q: string; canOpen: (path: string) => boolean; onPick: () => void }) {
  const needle = q.trim().toLowerCase();
  const hits = adminRoutes
    .filter((r) => r.path !== "error404" && canOpen(r.path))
    .map((r) => ({ route: r, menu: sectionLabelFor(r.path) }))
    .filter(({ route, menu }) => `${route.title} ${route.path} ${route.group} ${menu}`.toLowerCase().includes(needle))
    .slice(0, 20);
  if (!hits.length) return <p className="px-2 py-1 text-[11px] text-[#a9a9a9]">No pages or settings match.</p>;
  return (
    <>
      {hits.map(({ route, menu }) => (
        <Link key={route.path} href={`/${route.path}`} onClick={onPick} className="rounded-[8px] px-[7px] py-1.5 hover:bg-[#f6f6f6]">
          <span className="block truncate text-[13px]">{route.title}</span>
          <span className="block truncate text-[10px] text-[#a9a9a9]">{menu || route.group}</span>
        </Link>
      ))}
    </>
  );
}

function ProfileMenu({ expanded }: { expanded: boolean }) {
  const { profile, lang, setLang, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = String(profile?.display_name ?? profile?.user_name ?? profile?.email ?? "Admin");
  const role = String(profile?.role_unique_key ?? profile?.user_role ?? "");
  const photo = typeof profile?.photo_url === "string" ? profile.photo_url : "";
  const initials = useMemo(() => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), [name]);

  useEffect(() => {
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const item = "flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[#fafafa]";
  return (
    <div ref={ref} className="relative mt-1 border-t border-[#f0f0f0] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={expanded ? undefined : name}
        className={cx("flex w-full min-w-0 items-center gap-2 rounded-[8px] py-1.5 text-start hover:bg-[#f6f6f6]", expanded ? "px-[5px]" : "justify-center")}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="size-7 shrink-0 rounded-full bg-[#eee] object-cover" />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#c6f54a] text-[10px] font-semibold">{initials}</span>
        )}
        {expanded && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[12px] font-medium">{name}</span>
              {role && <span className="block truncate text-[10px] text-[#a9a9a9]">{role}</span>}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-[#a9a9a9]" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full start-0 z-50 mb-2 w-48 overflow-hidden rounded-[12px] border border-[#eee] bg-white py-1 text-[13px] shadow-lg">
          <Link href="/edit-profile" onClick={() => setOpen(false)} className={item}>
            <UserRound className="size-3.5" /> Edit profile
          </Link>
          <button type="button" onClick={() => setLang(lang === "en" ? "ar" : "en")} className={item}>
            <Languages className="size-3.5" /> {lang === "en" ? "العربية" : "English"}
          </button>
          <button type="button" onClick={() => void logout()} className={`${item} text-[#f52525]`}>
            <LogOut className="size-3.5" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
