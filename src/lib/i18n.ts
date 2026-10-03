export type Lang = "en" | "ar";

const en: Record<string, string> = {
  app: "Azyaa Admin",
  login: "Log in",
  logout: "Log out",
  email: "Email",
  password: "Password",
  dashboard: "Dashboard",
  save: "Save",
  create: "Create",
  search: "Search",
  forbidden: "You do not have permission for this page.",
  published: "Only published accounts can use the admin panel.",
};

const ar: Record<string, string> = {
  app: "إدارة أزياء",
  login: "تسجيل الدخول",
  logout: "خروج",
  email: "البريد",
  password: "كلمة المرور",
  dashboard: "لوحة التحكم",
  save: "حفظ",
  create: "إنشاء",
  search: "بحث",
  forbidden: "ليست لديك صلاحية لهذه الصفحة.",
  published: "فقط الحسابات المنشورة يمكنها استخدام لوحة الإدارة.",
};

export function t(lang: Lang, key: string) {
  return (lang === "ar" ? ar : en)[key] ?? en[key] ?? key;
}
