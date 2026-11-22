import { describe, expect, it } from "vitest";
import {
  PUSH_TITLE_MAX,
  chunk,
  failureText,
  filterRecipients,
  mergeOutcomes,
  outcomeText,
  pushPayload,
  readPushResult,
  recipientFromUser,
  stoppedSend,
  stoppedSendText,
  validatePush,
} from "@/features/marketing/push-rules";

describe("push payload", () => {
  it("uses exactly the keys the cloud function reads", () => {
    expect(pushPayload({ userIds: ["u1", "u2"], title: " Sale ", body: " Starts today " })).toEqual({ userIds: ["u1", "u2"], notificationTitle: "Sale", notificationBody: "Starts today" });
  });
  it("adds the picture and page only when they are set", () => {
    const payload = pushPayload({ userIds: ["u1"], title: "T", body: "B", imageUrl: "https://img.test/a.jpg", pageName: " Shop ", pageParameters: { id: "7" } });
    expect(payload).toEqual({ userIds: ["u1"], notificationTitle: "T", notificationBody: "B", imageUrl: "https://img.test/a.jpg", initialPageName: "Shop", initialPageParameters: { id: "7" } });
    expect(pushPayload({ userIds: ["u1"], title: "T", body: "B", imageUrl: "", pageName: " ", pageParameters: {} })).toEqual({ userIds: ["u1"], notificationTitle: "T", notificationBody: "B" });
  });
  it("drops empty and repeated ids", () => {
    expect(pushPayload({ userIds: ["u1", "", "u1", "u2"], title: "T", body: "B" }).userIds).toEqual(["u1", "u2"]);
  });
});

describe("push form", () => {
  it("needs a title, a message and someone to send to", () => {
    expect(validatePush({ title: "Hi", body: "There", imageUrl: "" }, 3)).toEqual({});
    expect(Object.keys(validatePush({ title: " ", body: "", imageUrl: "" }, 0)).sort()).toEqual(["body", "recipients", "title"]);
    expect(validatePush({ title: "x".repeat(PUSH_TITLE_MAX + 1), body: "ok", imageUrl: "" }, 1).title).toMatch(/100/);
  });
});

describe("recipients", () => {
  const people = [
    recipientFromUser("d1", { user_role: "Designer", display_name: "Login name", email: "login@x.test", status: "Published", designer_main_info: { designer_info: { name: "Maison Noor", email: "studio@noor.test" } } }),
    recipientFromUser("c1", { user_role: "Customer", display_name: "Sara Ali", email: "sara@x.test", status: "Published" }),
    recipientFromUser("c2", { user_role: "Customer", user_name: "omar", email: "omar@x.test", status: "Pending" }),
  ];
  it("shows designers and creators by their profile name", () => {
    expect(people[0]).toEqual({ id: "d1", name: "Maison Noor", email: "studio@noor.test", role: "Designer", status: "Published" });
    expect(people[2].name).toBe("omar");
  });
  it("filters by group and by name or email", () => {
    expect(filterRecipients(people, "Customer", "").map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(filterRecipients(people, "", "NOOR").map((p) => p.id)).toEqual(["d1"]);
    expect(filterRecipients(people, "Customer", "omar@").map((p) => p.id)).toEqual(["c2"]);
    expect(filterRecipients(people, "Creator", "")).toEqual([]);
  });
});

describe("push result", () => {
  const answer = { status: "done", summary: { success: [{ userId: "u1", messageId: "m" }], failed: [{ userId: "u2", reason: "No valid FCM token found" }, { userId: "u3" }] } };
  it("separates who was reached from who was not", () => {
    expect(readPushResult(answer)).toEqual({ sent: ["u1"], failed: [{ userId: "u2", reason: "No valid FCM token found" }, { userId: "u3", reason: "Unknown reason" }] });
    expect(readPushResult({})).toEqual({ sent: [], failed: [] });
    expect(readPushResult(null)).toEqual({ sent: [], failed: [] });
  });
  it("adds batches up and words the outcome", () => {
    const total = mergeOutcomes([readPushResult(answer), { sent: ["u4"], failed: [] }]);
    expect(total.sent).toEqual(["u1", "u4"]);
    expect(outcomeText(total)).toBe("Sent to 2 people; 2 people could not be reached.");
    expect(outcomeText({ sent: ["a"], failed: [] })).toBe("Sent to 1 person.");
    expect(outcomeText({ sent: [], failed: [{ userId: "x", reason: "r" }] })).toMatch(/Nobody was reached/);
  });
  it("explains the common failures in plain words", () => {
    expect(failureText("No valid FCM token found")).toBe("No device registered for notifications");
    expect(failureText("User not found")).toBe("Account not found");
    expect(failureText("Something else")).toBe("Something else");
  });
  it("splits a long list into calls", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("a send that stops part-way", () => {
  const batches = [["a1", "a2", "a3"], ["b1", "b2", "b3"], ["c1", "c2"]];
  const firstCall = { sent: ["a1", "a2"], failed: [{ userId: "a3", reason: "No valid FCM token found" }] };

  it("keeps only the people of the failed call and the calls never made", () => {
    const stop = stoppedSend(batches, [firstCall]);
    expect(stop).toEqual({ reached: 2, notReached: 1, uncertain: ["b1", "b2", "b3"], untried: ["c1", "c2"], remaining: ["b1", "b2", "b3", "c1", "c2"] });
    // Nobody from a completed call is selected again, reached or not, so a retry cannot send them a duplicate.
    expect(stop.remaining.some((id) => id.startsWith("a"))).toBe(false);
  });
  it("handles a failure in the first and in the last call", () => {
    expect(stoppedSend(batches, [])).toEqual({ reached: 0, notReached: 0, uncertain: ["a1", "a2", "a3"], untried: ["b1", "b2", "b3", "c1", "c2"], remaining: ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2"] });
    const last = stoppedSend(batches, [firstCall, { sent: ["b1", "b2", "b3"], failed: [] }]);
    expect(last).toMatchObject({ reached: 5, notReached: 1, uncertain: ["c1", "c2"], untried: [], remaining: ["c1", "c2"] });
  });
  it("says how many were sent and how many were not, without claiming the failed call reached nobody", () => {
    const text = stoppedSendText(stoppedSend(batches, [firstCall]), "deadline-exceeded");
    expect(text).toBe(
      "Sending stopped: deadline-exceeded. Sent to 2 people; 1 person could not be reached. 3 people may or may not have received it: the call that failed was sending to them. 2 people were not sent to. Only those 5 people are still selected, and your message is still here. Sending again may reach some of the 3 people a second time.",
    );
    expect(text).not.toMatch(/received nothing/);
  });
  it("words a failure of the very first call", () => {
    const text = stoppedSendText(stoppedSend([["a1"]], []), "internal");
    expect(text).toBe("Sending stopped: internal. Nobody is confirmed as sent to. 1 person may or may not have received it: the call that failed was sending to them. Only that 1 person is still selected, and your message is still here. Sending again may reach that person a second time.");
  });
});
