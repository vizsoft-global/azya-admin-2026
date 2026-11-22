import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; data: unknown }[] = [];

vi.mock("@/lib/firebase", () => ({ getFirebase: () => ({ functions: {} }) }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    return { data: { status: "done", summary: { success: [], failed: [] } } };
  },
}));

import { sendPushToUser, sendPushToUsers } from "@/lib/functions";
import { pushPayload } from "@/features/marketing/push-rules";

describe("push notification wrappers", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("calls sendPushNotificationToUsers with the keys the function requires", async () => {
    await sendPushToUsers(pushPayload({ userIds: ["u1", "u2"], title: "Sale", body: "Starts today", imageUrl: "https://img.test/a.jpg" }));
    expect(calls).toEqual([
      { name: "sendPushNotificationToUsers", data: { userIds: ["u1", "u2"], notificationTitle: "Sale", notificationBody: "Starts today", imageUrl: "https://img.test/a.jpg" } },
    ]);
  });

  it("converts the older call shape instead of sending keys the function ignores", async () => {
    await sendPushToUsers({ userRefs: ["users/u1", " u2 ", ""], title: "Hi", body: "There" });
    expect(calls[0]).toEqual({ name: "sendPushNotificationToUsers", data: { userIds: ["u1", "u2"], notificationTitle: "Hi", notificationBody: "There" } });
  });

  it("sends one person's notification with userId", async () => {
    await sendPushToUser({ userId: "u9", title: "Hi", body: "There" });
    expect(calls[0]).toEqual({ name: "sendPushNotificationToUser", data: { userId: "u9", notificationTitle: "Hi", notificationBody: "There" } });
  });
});
