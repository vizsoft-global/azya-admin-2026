import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const ProductAddPage = lazyPage(() => import("./product-editor").then((m) => m.ProductAddPage));
const ProductEditPage = lazyPage(() => import("./product-editor").then((m) => m.ProductEditPage));
const ProductSettingsPage = lazyPage(() => import("./product-settings-page").then((m) => m.ProductSettingsPage));
const PendingProductsPage = lazyPage(() => import("./products-page").then((m) => m.PendingProductsPage));
const ProductsGridPage = lazyPage(() => import("./products-page").then((m) => m.ProductsGridPage));
const ProductsListPage = lazyPage(() => import("./products-page").then((m) => m.ProductsListPage));
const SizeChartPage = lazyPage(() => import("./size-chart-page").then((m) => m.SizeChartPage));
const AttributesPage = lazyPage(() => import("./taxonomy-page").then((m) => m.AttributesPage));
const CategoriesPage = lazyPage(() => import("./taxonomy-page").then((m) => m.CategoriesPage));
const TagsPage = lazyPage(() => import("./taxonomy-page").then((m) => m.TagsPage));
const TermsPage = lazyPage(() => import("./taxonomy-page").then((m) => m.TermsPage));
const TranslationPage = lazyPage(() => import("./translation-page").then((m) => m.TranslationPage));

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
