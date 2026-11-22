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
import { tx } from "@/lib/i18n/tx";
import { PRODUCT_SETTINGS, PRODUCT_SETTINGS_PERMISSION, productSettingOn, productSettingPatch, type ProductSettingKey } from "./product-settings";

/** `/product-settings`: which optional fields the product form asks for. Each switch saves as it is flipped. */
export function ProductSettingsPage() {
  const { allowed } = useAuth();
  const { settings, loading, error } = useCompanySettings();
  const [saving, setSaving] = useState<ProductSettingKey | null>(null);
  const mayChange = allowed(PRODUCT_SETTINGS_PERMISSION);

  if (error) return <EmptyState icon={AlertTriangle} title={tx("The settings could not be loaded")} description={error} />;
  if (loading && !settings) return <PageLoading label={tx("Loading settings…")} />;
  if (!settings) return <EmptyState icon={AlertTriangle} title={tx("The Company settings record is missing")} description={tx("Product settings are kept on it, so there is nothing to change here until it exists.")} />;

  async function flip(key: ProductSettingKey, label: string, on: boolean) {
    if (!settings) return;
    setSaving(key);
    try {
      await updateDoc(doc(getFirebase().db, "settings", settings.id), productSettingPatch(key, on));
      toast.success(on ? tx("{field} is now asked for on the product form.", { field: tx(label) }) : tx("{field} is now hidden on the product form.", { field: tx(label) }));
    } catch (err) {
      toast.error(tx("{field} was not changed. {error}", { field: tx(label), error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="max-w-2xl rounded-[14px] bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">{tx("Fields on the product form")}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{tx("Turn off the fields your team does not fill in. Products keep any values they already have.")}</p>
      </div>
      <div className="grid gap-4 p-4">
        {PRODUCT_SETTINGS.map((item) => (
          <SwitchField
            key={item.key}
            label={tx(item.label)}
            hint={tx(item.hint)}
            checked={productSettingOn(settings.data, item.key)}
            onChange={(on) => void flip(item.key, item.label, on)}
            disabled={!mayChange || saving !== null}
          />
        ))}
      </div>
      {!mayChange ? <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">{tx("Your role can see these settings but cannot change them.")}</p> : null}
    </section>
  );
}
