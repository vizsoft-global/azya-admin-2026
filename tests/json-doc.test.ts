import { describe, expect, it } from "vitest";
import { initializeApp } from "firebase/app";
import { doc, DocumentReference, getFirestore, Timestamp } from "firebase/firestore";
import { docToJson, jsonToDoc } from "@/lib/json-doc";

const db = getFirestore(initializeApp({ projectId: "json-doc-test" }, "json-doc-test"));

describe("json-doc round trip", () => {
  it("keeps references and timestamps intact", () => {
    const at = Timestamp.fromDate(new Date("2026-04-27T08:25:38.320Z"));
    const source = {
      product: { inventory_ref: doc(db, "inventory/WPMkS48K3Eo4Fz6i6FwR"), price: "55" },
      promotion: [{ creator_ref: doc(db, "users/x9ai"), created_at: at }],
      name: "Kurta",
    };
    const back = jsonToDoc(docToJson(source), db);
    expect(back.product.inventory_ref).toBeInstanceOf(DocumentReference);
    expect(back.product.inventory_ref.path).toBe("inventory/WPMkS48K3Eo4Fz6i6FwR");
    expect(back.promotion[0].creator_ref.path).toBe("users/x9ai");
    expect(back.promotion[0].created_at).toBeInstanceOf(Timestamp);
    expect(back.promotion[0].created_at.isEqual(at)).toBe(true);
    expect(back.product.price).toBe("55");
    expect(back.name).toBe("Kurta");
  });
});
