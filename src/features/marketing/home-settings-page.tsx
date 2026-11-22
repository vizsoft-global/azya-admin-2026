"use client";

import { useEffect, useMemo, useState } from "react";
import { arrayRemove, arrayUnion, doc, runTransaction, updateDoc } from "firebase/firestore";
import { ArrowDown, ArrowUp, ImageIcon, LayoutPanelTop, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { BilingualField, Field, SwitchField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { MediaPicker } from "@/components/shared/media-picker";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useCompanySettings } from "@/lib/company-settings";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { useUnsavedChanges } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import {
  BANNER_LIST,
  BANNER_SUBTITLE_MAX,
  BANNER_SWITCH,
  BANNER_TITLE_MAX,
  HOME,
  HOME_CATEGORY_LIMIT,
  HOME_SWITCHES,
  addBanner,
  bannerFormFromStored,
  bannerList,
  emptyBannerForm,
  homeCategory,
  homeCategoryIds,
  moveBanner,
  removeBanner,
  updateBanner,
  validateBanner,
  type BannerErrors,
  type BannerForm,
  type BannerKind,
  type HomeCategory,
  type StoredBanner,
} from "./home-rules";
import { Section, errorText } from "./parts";

const settingsRef = (id: string) => doc(getFirebase().db, "settings", id);

export type HomeFocus = "sections" | "categories" | "main-banners" | "creator-banners";

/**
 * What the customer app's home page shows: section switches, the chosen
 * categories, and the main and creator-space banners (English, Arabic and
 * picture in one form). `focus` scrolls to one block.
 */
export function HomeSettingsPage({ focus }: { focus?: HomeFocus }) {
  const { settings, loading, error } = useCompanySettings();

  useEffect(() => {
    if (!focus || !settings) return;
    document.getElementById(`home-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus, settings]);

  if (error) return <EmptyState icon={LayoutPanelTop} title="The home page settings could not be loaded" description={`${error} Reload the page to try again.`} />;
  if (loading && !settings) return <PageLoading label="Loading home page settings…" />;
  if (!settings) return <EmptyState icon={LayoutPanelTop} title="No Company settings record was found" description="The home page reads its setup from that record. It is missing, so there is nothing to edit here." />;

  const home = settings.data[HOME];
  return (
    <div className="space-y-4">
      <SwitchesCard settingsId={settings.id} home={home} />
      <CategoriesCard settingsId={settings.id} home={home} />
      <BannersCard kind="main" settingsId={settings.id} home={home} />
      <BannersCard kind="creator" settingsId={settings.id} home={home} />
    </div>
  );
}

export function HomeCategoriesPage() {
  return <HomeSettingsPage focus="categories" />;
}

export function MainBannersPage() {
  return <HomeSettingsPage focus="main-banners" />;
}

export function CreatorBannersPage() {
  return <HomeSettingsPage focus="creator-banners" />;
}

const flag = (home: unknown, field: string) => (home as Record<string, unknown> | undefined)?.[field] === true;

function SwitchesCard({ settingsId, home }: { settingsId: string; home: unknown }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(field: string, label: string, next: boolean) {
    setBusy(field);
    try {
      await updateDoc(settingsRef(settingsId), { [`${HOME}.${field}`]: next });
      toast.success(`${label} is now ${next ? "shown" : "hidden"} on the home page.`);
    } catch (err) {
      toast.error(`${label} was not changed: ${errorText(err)}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section id="home-sections" title="Home page sections" description="Turn each part of the app's home page on or off. A change reaches customers straight away.">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {HOME_SWITCHES.map((item) => (
          <SwitchField key={item.field} label={item.label} hint={item.hint} checked={flag(home, item.field)} disabled={busy !== null} onChange={(checked) => void toggle(item.field, item.label, checked)} />
        ))}
      </div>
    </Section>
  );
}

function CategoriesCard({ settingsId, home }: { settingsId: string; home: unknown }) {
  const { rows, loading, error } = useQueryRows("category", { where: [["status", "==", "active"]], limit: 300 });
  const [busy, setBusy] = useState<string | null>(null);
  const chosen = useMemo(() => new Set(homeCategoryIds(home)), [home]);
  const categories = useMemo(
    () => rows.map((row: Row) => homeCategory(row.id, row.data)).filter((item): item is HomeCategory => item !== null).sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );
  const shownCount = categories.filter((item) => chosen.has(item.categoryId)).length;
  const sectionOn = flag(home, "settings_is_category_widget_status");

  async function toggle(category: HomeCategory, next: boolean) {
    setBusy(category.categoryId);
    try {
      await updateDoc(settingsRef(settingsId), { [`${HOME}.settings_categoryid_list`]: next ? arrayUnion(category.categoryId) : arrayRemove(category.categoryId) });
      toast.success(next ? `${category.name} added to the home page.` : `${category.name} removed from the home page.`);
    } catch (err) {
      toast.error(`${category.name} was not changed: ${errorText(err)}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      id="home-categories"
      title="Categories on the home page"
      description={`${shownCount} chosen. The app shows at most ${HOME_CATEGORY_LIMIT} of them.${sectionOn ? "" : " The Categories section is switched off above, so none are shown right now."}`}
    >
      {error ? (
        <p className="text-[13px] text-destructive">The categories could not be loaded: {error}</p>
      ) : loading && !categories.length ? (
        <div className="flex h-24 items-center justify-center"><Spinner /></div>
      ) : !categories.length ? (
        <p className="text-[13px] text-muted-foreground">There are no active categories yet. Add categories under Products first.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const on = chosen.has(category.categoryId);
            return (
              <li key={category.docId} className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", on ? "border-primary/50 bg-muted" : "border-border")}>
                <label htmlFor={`home-cat-${category.docId}`} className="min-w-0 cursor-pointer">
                  <span className="block truncate text-[13px] font-medium text-foreground">{category.name}</span>
                  {category.nameAr ? <span className="block truncate text-[12px] text-muted-foreground" dir="rtl" lang="ar">{category.nameAr}</span> : null}
                </label>
                <Switch id={`home-cat-${category.docId}`} checked={on} disabled={busy !== null} onCheckedChange={(checked) => void toggle(category, checked)} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

type BannerEdit = { index: number; banner: StoredBanner } | { index: -1; banner: null };

const KIND_COPY: Record<BannerKind, { title: string; description: string; noun: string }> = {
  main: { title: "Main banners", description: "The slider at the top of the app's home page, in this order.", noun: "main banner" },
  creator: { title: "Creator space banners", description: "The slider at the top of the creator space, in this order.", noun: "creator space banner" },
};

function BannersCard({ kind, settingsId, home }: { kind: BannerKind; settingsId: string; home: unknown }) {
  const confirm = useConfirm();
  const banners = useMemo(() => bannerList(home, kind), [home, kind]);
  const [editing, setEditing] = useState<BannerEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = KIND_COPY[kind];
  const sliderOn = flag(home, BANNER_SWITCH[kind]);

  /** Re-reads the list inside a transaction and writes the result of `change`; a null result means the banner is gone. */
  async function writeList(change: (list: StoredBanner[]) => StoredBanner[] | null) {
    const { db } = getFirebase();
    const ref = settingsRef(settingsId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = change(bannerList(snap.data()?.[HOME], kind));
      if (!next) throw new Error("this banner was changed or removed by someone else; the list has been refreshed");
      tx.update(ref, { [`${HOME}.${BANNER_LIST[kind]}`]: next });
    });
  }

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(`${failed}: ${errorText(err)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(index: number, banner: StoredBanner) {
    const name = String(banner.name ?? "this banner");
    const ok = await confirm({
      title: `Delete the banner “${name}”?`,
      description: "It disappears from the app straight away, with its Arabic text. The picture stays in the media library. This cannot be undone.",
      confirmLabel: "Delete banner",
      destructive: true,
    });
    if (!ok) return;
    await run(() => writeList((list) => removeBanner(list, index, banner)), `Banner “${name}” deleted.`, "The banner was not deleted");
  }

  const move = (index: number, banner: StoredBanner, step: -1 | 1) =>
    run(() => writeList((list) => moveBanner(list, index, banner, step)), "Banner order saved.", "The order was not changed");

  return (
    <Section
      id={`home-${kind}-banners`}
      title={copy.title}
      description={`${copy.description}${sliderOn ? "" : " This slider is switched off above, so customers do not see it right now."}`}
      actions={
        <Button size="sm" disabled={busy} onClick={() => setEditing({ index: -1, banner: null })}>
          <Plus /> Add banner
        </Button>
      }
    >
      {!banners.length ? (
        <EmptyState compact icon={ImageIcon} title={`No ${copy.noun}s yet`} description="Add a banner with a title, a subtitle and a picture." />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {banners.map((banner, index) => {
            const form = bannerFormFromStored(banner);
            return (
              <li key={`${index}-${form.titleEn}`} className="flex gap-3 rounded-lg border border-border p-2">
                {form.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.image} alt="" loading="lazy" className="size-20 shrink-0 rounded-md bg-muted object-cover sm:size-24" />
                ) : (
                  <span className="grid size-20 shrink-0 place-items-center rounded-md bg-muted text-subtle sm:size-24"><ImageIcon className="size-5" aria-hidden /></span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-[13px] font-medium text-foreground">{form.titleEn || "Untitled"}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{form.subtitleEn}</p>
                  {form.titleAr || form.subtitleAr ? (
                    <p className="mt-1 truncate text-[12px] text-muted-foreground" dir="rtl" lang="ar">{[form.titleAr, form.subtitleAr].filter(Boolean).join(" — ")}</p>
                  ) : (
                    <p className="mt-1 text-[12px] text-destructive">No Arabic text yet: Arabic readers see blank text on this banner.</p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing({ index, banner })}>
                      <Pencil /> Edit
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={busy || index === 0} aria-label={`Move “${form.titleEn}” earlier`} onClick={() => void move(index, banner, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={busy || index === banners.length - 1} aria-label={`Move “${form.titleEn}” later`} onClick={() => void move(index, banner, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="ms-auto text-destructive" disabled={busy} aria-label={`Delete “${form.titleEn}”`} onClick={() => void remove(index, banner)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <BannerModal
          key={editing.index}
          kind={kind}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(form) => (editing.banner ? writeList((list) => updateBanner(list, editing.index, editing.banner, form)) : writeList((list) => addBanner(list, form)))}
        />
      ) : null}
    </Section>
  );
}

function BannerModal({ kind, editing, onClose, onSave }: { kind: BannerKind; editing: BannerEdit; onClose: () => void; onSave: (form: BannerForm) => Promise<void> }) {
  const before = useMemo(() => (editing.banner ? bannerFormFromStored(editing.banner) : emptyBannerForm()), [editing.banner]);
  const [form, setForm] = useState<BannerForm>(before);
  const [errors, setErrors] = useState<BannerErrors>({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(before);
  useUnsavedChanges(dirty);
  const noun = KIND_COPY[kind].noun;

  async function save() {
    const found = validateBanner(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await onSave(form);
      toast.success(editing.banner ? `Banner “${form.titleEn.trim()}” saved.` : `Banner “${form.titleEn.trim()}” added to the app.`);
      onClose();
    } catch (err) {
      toast.error(`The banner was not saved: ${errorText(err)}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormModal
        open
        size="lg"
        onOpenChange={(open) => !open && onClose()}
        title={editing.banner ? `Edit ${noun}` : `Add ${noun}`}
        description="Customers reading in Arabic see the Arabic text; everyone else sees the English."
        onSubmit={save}
        submitting={saving}
        submitLabel={editing.banner ? "Save banner" : "Add banner"}
        submitDisabled={Boolean(editing.banner) && !dirty}
      >
        <BilingualField
          label="Title"
          required
          value={{ en: form.titleEn, ar: form.titleAr }}
          onChange={(value) => setForm((current) => ({ ...current, titleEn: value.en, titleAr: value.ar }))}
          error={errors.titleEn ?? errors.titleAr}
          hint={`Up to ${BANNER_TITLE_MAX} characters each.`}
        />
        <BilingualField
          label="Subtitle"
          required
          multiline
          rows={2}
          value={{ en: form.subtitleEn, ar: form.subtitleAr }}
          onChange={(value) => setForm((current) => ({ ...current, subtitleEn: value.en, subtitleAr: value.ar }))}
          error={errors.subtitleEn ?? errors.subtitleAr}
          hint={`Up to ${BANNER_SUBTITLE_MAX} characters each.`}
        />
        <Field label="Picture" required error={errors.image}>
          <div className="flex items-center gap-3">
            {form.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.image} alt="" className="h-20 w-32 rounded-md bg-muted object-cover" />
            ) : (
              <span className="grid h-20 w-32 place-items-center rounded-md bg-muted text-subtle"><ImageIcon className="size-5" aria-hidden /></span>
            )}
            <Button type="button" variant="outline" disabled={saving} onClick={() => setPicking(true)}>
              {form.image ? "Change picture" : "Choose picture"}
            </Button>
          </div>
        </Field>
      </FormModal>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title="Choose the banner picture"
        onPick={(items) => {
          const item = items[0];
          if (!item) return;
          setForm((current) => ({ ...current, image: item.url, imageId: item.uploaderUid }));
          setErrors((current) => ({ ...current, image: undefined }));
        }}
      />
    </>
  );
}
