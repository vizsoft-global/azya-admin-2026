"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { SwitchField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { useCompanySettings } from "@/lib/company-settings";
import { getFirebase } from "@/lib/firebase";
import { PRODUCT_SETTINGS, PRODUCT_SETTINGS_PERMISSION, productSettingOn, productSettingPatch, type ProductSettingKey } from "./product-settings";

/** `/product-settings`: which optional fields the product form asks for. Each switch saves as it is flipped. */
export function ProductSettingsPage() {
  const { allowed } = useAuth();
  const { settings, loading, error } = useCompanySettings();
  const [saving, setSaving] = useState<ProductSettingKey | null>(null);
  const mayChange = allowed(PRODUCT_SETTINGS_PERMISSION);

  if (error) return <EmptyState icon={AlertTriangle} title="The settings could not be loaded" description={error} />;
  if (loading && !settings) return <PageLoading label="Loading settings…" />;
  if (!settings) return <EmptyState icon={AlertTriangle} title="The Company settings record is missing" description="Product settings are kept on it, so there is nothing to change here until it exists." />;

  async function flip(key: ProductSettingKey, label: string, on: boolean) {
    if (!settings) return;
    setSaving(key);
    try {
      await updateDoc(doc(getFirebase().db, "settings", settings.id), productSettingPatch(key, on));
      toast.success(`${label} is now ${on ? "asked for" : "hidden"} on the product form.`);
    } catch (err) {
      toast.error(`${label} was not changed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="max-w-2xl rounded-[14px] bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">Fields on the product form</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Turn off the fields your team does not fill in. Products keep any values they already have.</p>
      </div>
      <div className="grid gap-4 p-4">
        {PRODUCT_SETTINGS.map((item) => (
          <SwitchField
            key={item.key}
            label={item.label}
            hint={item.hint}
            checked={productSettingOn(settings.data, item.key)}
            onChange={(on) => void flip(item.key, item.label, on)}
            disabled={!mayChange || saving !== null}
          />
        ))}
      </div>
      {!mayChange ? <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">Your role can see these settings but cannot change them.</p> : null}
    </section>
  );
}
