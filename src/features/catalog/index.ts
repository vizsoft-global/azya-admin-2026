import type { ComponentType } from "react";
import { ProductAddPage, ProductEditPage } from "./product-editor";
import { ProductSettingsPage } from "./product-settings-page";
import { PendingProductsPage, ProductsGridPage, ProductsListPage } from "./products-page";
import { SizeChartPage } from "./size-chart-page";
import { AttributesPage, CategoriesPage, TagsPage, TermsPage } from "./taxonomy-page";
import { TranslationPage } from "./translation-page";

// The catalog team owns this folder (products, categories, tags, attributes, size charts): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
export const pages: Record<string, ComponentType> = {
  "products": ProductsListPage,
  "products-grid": ProductsGridPage,
  "pending-products": PendingProductsPage,
  "product-add": ProductAddPage,
  "product-edit": ProductEditPage,
  "product-settings": ProductSettingsPage,
  "size-chart": SizeChartPage,
  "category": CategoriesPage,
  "tags": TagsPage,
  "attributes": AttributesPage,
  "terms": TermsPage,
  "translation": TranslationPage,
};
