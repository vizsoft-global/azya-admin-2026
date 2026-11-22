import { describe, expect, it } from "vitest";
import { inCreatorTab } from "@/features/people/creators";
import {
  MIN_NAME_PREFIX,
  PREFIX_END,
  mergeHits,
  phoneVariants,
  planAccountSearch,
  searchClauses,
  searchNote,
  searchableText,
  uniqueRows,
  type SearchQuery,
} from "@/features/people/search";

const values = (queries: SearchQuery[], field: SearchQuery["field"]) => queries.filter((query) => query.field === field).map((query) => query.value);

describe("planning an all-accounts search", () => {
  it("asks nothing for an empty or very short term", () => {
    expect(planAccountSearch("")).toEqual([]);
    expect(planAccountSearch("   ")).toEqual([]);
    expect(planAccountSearch("da")).toEqual([]);
    expect(MIN_NAME_PREFIX).toBe(3);
  });

  it("looks up a full email as typed and lower-cased, once each", () => {
    const plan = planAccountSearch("  Dana@Mail.KW ");
    expect(values(plan, "email")).toEqual(["dana@mail.kw", "Dana@Mail.KW"]);
    expect(plan.filter((query) => query.field === "email").every((query) => query.kind === "equal")).toBe(true);
    expect(values(planAccountSearch("dana@mail.kw"), "email")).toEqual(["dana@mail.kw"]);
    // Half an email is not an exact match for anything; it is only tried as the start of a name.
    expect(values(planAccountSearch("dana@"), "email")).toEqual([]);
  });

  it("tries the forms a Kuwait number is stored in when 8 digits are typed", () => {
    // The apps store 96550001234 (sign-up) or +96550001234 (phone verification).
    expect(phoneVariants("50001234")).toEqual(["50001234", "+50001234", "96550001234", "+96550001234"]);
    expect(phoneVariants("5000 1234")).toEqual(["5000 1234", "50001234", "+50001234", "96550001234", "+96550001234"]);
    const plan = planAccountSearch("50001234");
    expect(values(plan, "phone_number")).toContain("96550001234");
    expect(values(plan, "phone_number")).toContain("+96550001234");
    expect(plan.every((query) => query.field === "phone_number" && query.kind === "equal")).toBe(true);
  });

  it("tries a full number with and without the plus", () => {
    expect(phoneVariants("+96550001234")).toEqual(["+96550001234", "96550001234"]);
    expect(phoneVariants("96550001234")).toEqual(["96550001234", "+96550001234"]);
    expect(phoneVariants("0096550001234")).toEqual(["0096550001234", "+0096550001234", "96550001234", "+96550001234"]);
    expect(phoneVariants("+965 5000-1234")).toContain("+96550001234");
  });

  it("does not treat short numbers, long numbers or text as a phone", () => {
    expect(phoneVariants("12345")).toEqual([]);
    expect(phoneVariants("1234567890123456")).toEqual([]);
    expect(phoneVariants("dana 123")).toEqual([]);
    expect(phoneVariants("AZYD12")).toEqual([]);
  });

  it("matches the start of the display name, as typed and capitalised", () => {
    const plan = planAccountSearch("dana al");
    expect(plan).toEqual([
      { field: "display_name", kind: "prefix", value: "dana al" },
      { field: "display_name", kind: "prefix", value: "Dana al" },
    ]);
    // Already capitalised: one question, not two.
    expect(planAccountSearch("Dana")).toEqual([{ field: "display_name", kind: "prefix", value: "Dana" }]);
    // Arabic has no capitals.
    expect(planAccountSearch("دانة أحمد")).toHaveLength(1);
    // A phone number is never tried as a name.
    expect(values(planAccountSearch("50001234"), "display_name")).toEqual([]);
  });

  it("keeps every question on one field, so no composite index is needed", () => {
    for (const term of ["dana@mail.kw", "50001234", "+96550001234", "Dana", "dana al"]) {
      for (const query of planAccountSearch(term)) {
        const clauses = searchClauses(query);
        expect(new Set(clauses.map((clause) => clause[0])).size).toBe(1);
        expect(clauses.length).toBeLessThanOrEqual(2);
      }
    }
    expect(searchClauses({ field: "email", kind: "equal", value: "a@b.kw" })).toEqual([["email", "==", "a@b.kw"]]);
    expect(searchClauses({ field: "display_name", kind: "prefix", value: "Dan" })).toEqual([
      ["display_name", ">=", "Dan"],
      ["display_name", "<=", `Dan${PREFIX_END}`],
    ]);
    expect(PREFIX_END).toBe("");
  });
});

describe("merging search hits", () => {
  const row = (id: string, data: Record<string, unknown> = {}) => ({ id, data });

  it("removes repeats across answers", () => {
    expect(uniqueRows([[row("a"), row("b")], [row("b"), row("c")], []]).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("adds only accepted hits that are not loaded already, and keeps the loaded copy", () => {
    const loaded = [row("a", { user_role: "Customer", v: "live" })];
    const hits = [row("a", { user_role: "Customer", v: "stale" }), row("b", { user_role: "Customer" }), row("c", { user_role: "Admin" }), row("b", { user_role: "Customer" })];
    const merged = mergeHits(loaded, hits, (item) => item.data.user_role === "Customer");
    expect(merged.rows.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged.rows[0].data.v).toBe("live");
    expect([...merged.extraIds]).toEqual(["b"]);
  });

  it("never lets a search on the Customers page surface a staff account", () => {
    const staff = row("s", { user_role: "Admin", role_unique_key: "super_admin", email: "boss@azyaa.ai" });
    const merged = mergeHits([], [staff], (item) => item.data.user_role === "Customer");
    expect(merged.rows).toEqual([]);
    expect(merged.extraIds.size).toBe(0);
  });

  it("holds a hit to the tab's own rule", () => {
    const pending = row("p", { status: "Published", creator_requests: { status: "Pending" } });
    const unpublished = row("u", { status: "Secret", creator_requests: { status: "Pending" } });
    const customer = row("c", { status: "Published", user_role: "Customer" });
    const accept = (item: { data: Record<string, unknown> }) => item.data.status === "Published" && inCreatorTab(item.data, "Pending");
    expect(mergeHits([], [pending, unpublished, customer], accept).rows.map((item) => item.id)).toEqual(["p"]);
  });

  it("returns the same list when nothing was added", () => {
    const loaded = [row("a")];
    expect(mergeHits(loaded, [], () => true).rows).toBe(loaded);
  });

  it("always keeps a row the server found, whatever form matched", () => {
    expect(searchableText(["Dana", "", "+96550001234"], false, "5000 1234")).toBe("Dana +96550001234");
    expect(searchableText(["Dana", "+96550001234"], true, " 5000 1234 ").toLowerCase()).toContain("5000 1234");
  });
});

describe("the line beside the search box", () => {
  const base = { searching: false, error: "", extra: 0 };

  it("says nothing without a term", () => {
    expect(searchNote({ ...base, term: "" })).toBe("");
  });

  it("explains when only the loaded rows are searched", () => {
    expect(searchNote({ ...base, term: "da" })).toContain("loaded rows");
    expect(searchNote({ ...base, term: "dana", error: "offline" })).toBe("Only the loaded rows were searched: offline");
  });

  it("says when matches come from beyond the loaded rows", () => {
    expect(searchNote({ ...base, term: "dana", searching: true })).toBe("Searching every account…");
    expect(searchNote({ ...base, term: "dana", extra: 1 })).toBe("Includes 1 match from beyond the loaded rows.");
    expect(searchNote({ ...base, term: "dana", extra: 3, elsewhere: "More matches on other tabs (Active: 1)." })).toBe("Includes 3 matches from beyond the loaded rows. More matches on other tabs (Active: 1).");
    expect(searchNote({ ...base, term: "dana" })).toContain("Every account was searched");
  });
});
