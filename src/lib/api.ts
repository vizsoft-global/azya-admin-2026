// The only outside service the panel calls directly: the one-time code sender used by the waitlist page.
// Payments are never taken or refunded from the panel.
const PROXY = "https://proxy.vizsoft.in";

export const ApiGroups = {
  otp: {
    baseUrl: `${PROXY}/https://nocodeplayground.onrender.com/`,
    headers: {
      "Content-Type": "application/json",
      "x-requested-with": PROXY,
    },
    calls: {
      send: "send_opt_whatsapp",
      resend: "resend_opt_whatsapp",
      verify: "verify_opt_whatsapp",
      sendSms: "send_opt_sms",
      verifySms: "verify_opt_sms",
      email: "send_opt_email",
    },
  },
} as const;

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}
