"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, ChevronsUpDown, Languages, Lock, LockOpen, LogOut, Menu, Palette, PanelLeftClose, PanelLeftOpen, Search, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { HeaderSlotContext, InShellContext, type SlotTargets } from "@/components/header-slots";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { tx, txIn } from "@/lib/i18n/tx";
import type { NavLeaf, NavSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { THEMES, THEME_LABELS, ThemeToggle, currentTheme, type ThemeName } from "./theme-toggle";
import { useSidebarPrefs } from "./use-sidebar-prefs";

export type ShellNav = { main: NavSection[]; secondary: NavSection[]; settings: NavSection[] };
export type ShellTab = { path: string; label: string };
export type ShellCrumb = { label: string; path?: string };
export type ShellPageHit = { path: string; title: string; menu: string };
export type ShellProfile = { name: string; role?: string; photo?: string };

export type ShellFrameProps = {
  /** Sidebar sections, already filtered to what the user may open. */
  nav: ShellNav;
  /** Route path of the page on screen, without the leading slash. */
  active: string;
  /** Page title, shown when there is no tab strip. */
  title: string;
  /** Sibling pages of the same sidebar link; two or more render as a tab strip in place of the title. */
  tabs?: ShellTab[];
  /** Trail above the top row, for pages opened from a button or a row rather than from the sidebar. */
  crumbs?: ShellCrumb[];
  profile: ShellProfile;
  /** Route path of the profile page. */
  profilePath?: string;
  lang: Lang;
  onLang: (lang: Lang) => void;
  onLogout: () => void;
  /** Page search behind the sidebar's search box. */
  searchPages: (term: string) => ShellPageHit[];
  /** Turns a route path into a link target. Default `/${path}`. */
  hrefFor?: (path: string) => string;
  /** Short build label shown at the foot of the sidebar. */
  version?: string;
  children: ReactNode;
};

/*
 * Menu labels, page titles, tab labels and breadcrumb labels arrive in English (they are plain data in
 * `lib/nav.ts` and `lib/routes.ts`) and are translated here, where they are shown.
 */

/** "Partners › Designers", each part translated. In right-to-left text the browser mirrors the "›" itself. */
const menuText = (menu: string) => menu.split(" › ").map((part) => tx(part)).join(" › ");

const inLeaf = (leaf: NavLeaf, path: string) => leaf.tabs.includes(path) || Boolean(leaf.hidden?.includes(path));
const defaultHref = (path: string) => `/${path}`;

/**
 * The panel chrome: canvas, sidebar rail, bordered work area and the top row.
 * It takes everything as props (no auth, no route table), so the signed-in
 * shell and the design preview render the same frame.
 */
export function ShellFrame({
  nav,
  active,
  title,
  tabs = [],
  crumbs = [],
  profile,
  profilePath = "edit-profile",
  lang,
  onLang,
  onLogout,
  searchPages,
  hrefFor = defaultHref,
  version,
  children,
}: ShellFrameProps) {
  const { prefs, toggleCollapsed, toggleLocked } = useSidebarPrefs();
  const [hover, setHover] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [slots, setSlots] = useState<SlotTargets>({ center: null, actions: null });
  const centerRef = useCallback((el: HTMLDivElement | null) => setSlots((cur) => (cur.center === el ? cur : { ...cur, center: el })), []);
  const actionsRef = useCallback((el: HTMLDivElement | null) => setSlots((cur) => (cur.actions === el ? cur : { ...cur, actions: el })), []);

  // Following a link closes the mobile drawer.
  useEffect(() => setMobileOpen(false), [active]);

  const expanded = mobileOpen || !prefs.collapsed || (!prefs.locked && hover);
  const showTabs = tabs.length > 1 && tabs.some((tab) => tab.path === active);

  return (
    <div className="h-svh overflow-hidden bg-canvas p-[5px] text-foreground">
      <div className="flex h-full min-h-0 gap-[5px] rounded-[16px] bg-canvas">
        {mobileOpen ? <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden /> : null}
        <aside
          className={cn(
            "z-40 h-full shrink-0 flex-col overflow-hidden rounded-[12px] bg-sidebar py-4 text-sidebar-foreground transition-[width] duration-200",
            expanded ? "w-[168px] px-2" : "w-[60px] px-1",
            mobileOpen ? "fixed inset-y-[5px] start-[5px] flex h-auto shadow-xl" : "hidden md:flex",
          )}
          onMouseEnter={() => {
            if (prefs.collapsed && !prefs.locked) setHover(true);
          }}
          onMouseLeave={() => setHover(false)}
        >
          <Sidebar
            nav={nav}
            active={active}
            expanded={expanded}
            collapsed={prefs.collapsed}
            locked={prefs.locked}
            onToggleCollapsed={() => {
              toggleCollapsed();
              setHover(false);
            }}
            onToggleLocked={toggleLocked}
            searchPages={searchPages}
            hrefFor={hrefFor}
            version={version}
          />
        </aside>
        <main className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-[14px] border border-border bg-background px-5 py-3">
          {/* Centre the work area on wide displays instead of stretching edge to edge. */}
          <div className="mx-auto w-full max-w-[1480px]">
            {crumbs.length > 1 ? <Breadcrumbs crumbs={crumbs} hrefFor={hrefFor} /> : null}
            <header className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 pb-4">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground md:hidden"
                aria-label={tx("Open menu")}
              >
                <Menu className="size-4" />
              </button>
              <div className="min-w-0 shrink-0">
                {showTabs ? (
                  <nav className="flex flex-wrap items-center gap-1" aria-label={tx("Section pages")}>
                    {tabs.map((tab) => (
                      <Link
                        key={tab.path}
                        href={hrefFor(tab.path)}
                        aria-current={tab.path === active ? "page" : undefined}
                        className={cn(
                          "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          tab.path === active ? "bg-card font-medium text-heading shadow-sm" : "text-muted-foreground hover:text-heading",
                        )}
                      >
                        {tx(tab.label)}
                      </Link>
                    ))}
                  </nav>
                ) : (
                  <h1 className="truncate text-[20px] font-semibold tracking-tight text-foreground">{tx(title)}</h1>
                )}
              </div>
              <div ref={centerRef} className="flex min-w-[160px] flex-1 justify-center px-2 empty:hidden" />
              <div className="ms-auto flex shrink-0 flex-wrap items-center gap-3">
                <div ref={actionsRef} className="flex flex-wrap items-center gap-2 empty:hidden" />
                <ThemeToggle className="hidden sm:grid" />
                <LanguageSwitch lang={lang} onLang={onLang} className="hidden sm:flex" />
                <ProfileMenu profile={profile} profileHref={hrefFor(profilePath)} lang={lang} onLang={onLang} onLogout={onLogout} />
              </div>
            </header>
            <InShellContext.Provider value={true}>
              <HeaderSlotContext.Provider value={slots}>{children}</HeaderSlotContext.Provider>
            </InShellContext.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Back arrow and trail for a page that is not itself in the sidebar. */
function Breadcrumbs({ crumbs, hrefFor }: { crumbs: ShellCrumb[]; hrefFor: (path: string) => string }) {
  const router = useRouter();
  const parent = [...crumbs].slice(0, -1).reverse().find((crumb) => crumb.path);
  return (
    <nav aria-label={tx("Breadcrumb")} className="mb-2 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) router.back();
          else if (parent?.path) router.push(hrefFor(parent.path));
        }}
        title={tx("Back")}
        aria-label={tx("Back")}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-card hover:text-foreground"
      >
        <ArrowLeft className="size-3.5 rtl:rotate-180" />
      </button>
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const label = tx(crumb.label);
          const text = (
            <span className="block max-w-[200px] truncate" title={label}>
              {label}
            </span>
          );
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {last ? (
                <span aria-current="page" className="min-w-0 font-medium text-foreground">
                  {text}
                </span>
              ) : crumb.path ? (
                <Link href={hrefFor(crumb.path)} className="min-w-0 hover:text-foreground hover:underline">
                  {text}
                </Link>
              ) : (
                <span className="min-w-0">{text}</span>
              )}
              {!last ? <ChevronRight className="size-3 shrink-0 text-subtle rtl:rotate-180" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Sidebar({
  nav,
  active,
  expanded,
  collapsed,
  locked,
  onToggleCollapsed,
  onToggleLocked,
  searchPages,
  hrefFor,
  version,
}: {
  nav: ShellNav;
  active: string;
  expanded: boolean;
  collapsed: boolean;
  locked: boolean;
  onToggleCollapsed: () => void;
  onToggleLocked: () => void;
  searchPages: (term: string) => ShellPageHit[];
  hrefFor: (path: string) => string;
  version?: string;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const railButton = "rounded-md p-1 text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <>
      <div className={cn("mb-3 flex min-w-0", expanded ? "items-center gap-2 px-1" : "flex-col items-center gap-1")}>
        <span className="grid size-[26px] shrink-0 place-items-center rounded-[6px] bg-brand text-[15px] leading-none font-bold text-brand-foreground" aria-hidden>
          ✱
        </span>
        {expanded ? <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-foreground">azyaa</span> : null}
      </div>

      {expanded ? (
        <label className="mb-4 flex h-[30px] items-center gap-2 rounded-full bg-card px-3 text-[12px] ring-1 ring-border">
          <Search className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder={tx("Search… ⌘K")}
            aria-label={tx("Search pages")}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-subtle"
          />
        </label>
      ) : null}

      <nav className="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label={txIn("navigation", "Main")}>
        {expanded && q.trim() ? (
          <PageSearch hits={searchPages(q)} hrefFor={hrefFor} onPick={() => setQ("")} />
        ) : (
          <>
            {nav.main.map((section) => (
              <SectionItem key={section.label} section={section} active={active} expanded={expanded} hrefFor={hrefFor} />
            ))}
            {nav.main.length && nav.secondary.length ? <div className="my-2" /> : null}
            {nav.secondary.map((section) => (
              <SectionItem key={section.label} section={section} active={active} expanded={expanded} hrefFor={hrefFor} />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto pt-2">
        {/* Expanded: Settings with the rail toggles on the same row. Collapsed: stacked. */}
        <div className={cn("flex items-center gap-1", expanded ? "flex-row" : "flex-col")}>
          <div className={cn("min-w-0", expanded && "flex-1")}>
            {nav.settings.map((section) => (
              <SectionItem key={section.label} section={section} active={active} expanded={expanded} hrefFor={hrefFor} />
            ))}
          </div>
          <div className={cn("hidden shrink-0 items-center gap-0.5 md:flex", !expanded && "flex-col")}>
            <button type="button" className={railButton} title={collapsed ? tx("Expand sidebar") : tx("Collapse sidebar")} aria-label={collapsed ? tx("Expand sidebar") : tx("Collapse sidebar")} onClick={onToggleCollapsed}>
              {collapsed ? <PanelLeftOpen className="size-3.5 rtl:rotate-180" /> : <PanelLeftClose className="size-3.5 rtl:rotate-180" />}
            </button>
            <button
              type="button"
              className={railButton}
              title={locked ? tx("Let the collapsed sidebar open on hover") : tx("Keep the collapsed sidebar closed on hover")}
              aria-label={locked ? tx("Unlock sidebar") : tx("Lock sidebar")}
              aria-pressed={locked}
              onClick={onToggleLocked}
            >
              {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            </button>
          </div>
        </div>
        {expanded && version ? (
          <p className="mt-2 px-[9px] text-[10px] text-subtle" title={tx("Build {version}", { version })}>
            v{version}
          </p>
        ) : null}
      </div>
    </>
  );
}

const rowClass = (on: boolean, expanded: boolean) =>
  cn(
    "flex w-full min-w-0 items-center gap-2 rounded-[8px] py-1.5 text-start text-[13px] text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    expanded ? "px-[7px]" : "justify-center px-0",
    on ? "bg-sidebar-accent font-medium" : "hover:bg-sidebar-accent/60",
  );

function SectionItem({ section, active, expanded, hrefFor }: { section: NavSection; active: string; expanded: boolean; hrefFor: (path: string) => string }) {
  const router = useRouter();
  const Icon = section.icon;
  const label = tx(section.label);
  const children = section.children;
  const containsActive = children ? children.some((child) => inLeaf(child, active)) : Boolean(section.tabs?.includes(active) || section.hidden?.includes(active));
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  if (!children) {
    return (
      <Link href={hrefFor(section.tabs![0])} title={expanded ? undefined : label} aria-current={containsActive ? "page" : undefined} className={rowClass(containsActive, expanded)}>
        <Icon className="size-4 shrink-0" strokeWidth={1.6} />
        {expanded ? (
          <span className="truncate" title={label}>
            {label}
          </span>
        ) : null}
      </Link>
    );
  }

  const first = hrefFor(children[0].tabs[0]);
  return (
    <div>
      <button
        type="button"
        title={expanded ? undefined : label}
        aria-expanded={expanded ? open : undefined}
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
        {expanded ? (
          <span className={cn("flex-1 truncate", containsActive && "font-medium")} title={label}>
            {label}
          </span>
        ) : null}
      </button>
      {expanded && open ? (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {children.map((child) => (
            <ChildLink key={child.label} leaf={child} on={inLeaf(child, active)} href={hrefFor(child.tabs[0])} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChildLink({ leaf, on, href }: { leaf: NavLeaf; on: boolean; href: string }) {
  const label = tx(leaf.label);
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "relative flex min-w-0 items-center rounded-[8px] py-1.5 ps-[30px] pe-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {on ? (
        <svg className="absolute start-[12px] top-[3px] text-subtle rtl:-scale-x-100" width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
          <path d="M1 0v7a4 4 0 0 0 4 4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : null}
      <span className="truncate" title={label}>
        {label}
      </span>
    </Link>
  );
}

function PageSearch({ hits, hrefFor, onPick }: { hits: ShellPageHit[]; hrefFor: (path: string) => string; onPick: () => void }) {
  if (!hits.length) return <p className="px-2 py-1 text-[11px] text-subtle">{tx("No pages or settings match.")}</p>;
  return (
    <>
      {hits.map((hit) => (
        <Link key={hit.path} href={hrefFor(hit.path)} onClick={onPick} className="rounded-[8px] px-[7px] py-1.5 outline-none hover:bg-sidebar-accent/60 focus-visible:bg-sidebar-accent">
          <span className="block truncate text-[13px] text-foreground">{tx(hit.title)}</span>
          <span className="block truncate text-[10px] text-subtle">{menuText(hit.menu)}</span>
        </Link>
      ))}
    </>
  );
}

const LANG_LABELS: Record<Lang, string> = { en: "English", ar: "العربية" };

function LanguageSwitch({ lang, onLang, className }: { lang: Lang; onLang: (lang: Lang) => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tx("Language")}
        className={cn("h-8 items-center gap-2 rounded-full bg-muted px-3 text-[12px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      >
        <Languages className="size-3.5 text-muted-foreground" />
        {LANG_LABELS[lang]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-[140px]">
        {(Object.keys(LANG_LABELS) as Lang[]).map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onLang(option)} className="gap-2">
            {LANG_LABELS[option]}
            {lang === option ? <Check className="ms-auto size-3.5 text-subtle" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu({
  profile,
  profileHref,
  lang,
  onLang,
  onLogout,
}: {
  profile: ShellProfile;
  profileHref: string;
  lang: Lang;
  onLang: (lang: Lang) => void;
  onLogout: () => void;
}) {
  const { setTheme } = useTheme();
  const [theme, setShownTheme] = useState<ThemeName>("light");
  const other: Lang = lang === "en" ? "ar" : "en";
  return (
    <DropdownMenu onOpenChange={(open) => open && setShownTheme(currentTheme())}>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={tx("Account menu")}>
        {profile.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photo} alt="" className="size-8 shrink-0 rounded-full bg-muted object-cover" />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">{initialsOf(profile.name)}</span>
        )}
        <span className="hidden max-w-[140px] text-[12px] leading-tight lg:block">
          <span className="block truncate font-medium text-foreground">{profile.name}</span>
          {profile.role ? <span className="block truncate text-[10px] text-subtle">{profile.role}</span> : null}
        </span>
        <ChevronsUpDown className="hidden size-3.5 shrink-0 text-subtle lg:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="lg:hidden">
          <span className="block truncate text-[13px] font-medium text-foreground">{profile.name}</span>
          {profile.role ? <span className="block truncate text-[11px] font-normal text-subtle">{profile.role}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={profileHref}>
            <UserRound /> {tx("Edit profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onLang(other)}>
          <Languages /> {LANG_LABELS[other]}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-normal text-subtle">
          <Palette className="size-3.5" /> {tx("Theme")}
        </DropdownMenuLabel>
        {THEMES.map((name) => (
          <DropdownMenuItem
            key={name}
            onSelect={(event) => {
              // Keep the menu open so the three themes can be compared in place.
              event.preventDefault();
              setTheme(name);
              setShownTheme(name);
            }}
          >
            {tx(THEME_LABELS[name])}
            {theme === name ? <Check className="ms-auto size-3.5 text-subtle" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOut className="rtl:-scale-x-100" /> {tx("Log out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
