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
  upayments: {
    baseUrl: `${PROXY}/https://sandbox.upayments.com/api/v1/`,
    calls: { charge: "charge", status: "get-payment-status" },
  },
  tap: {
    baseUrl: `${PROXY}/https://api.tap.company/`,
    calls: { charge: "v2/charges", status: "v2/charges" },
  },
  upload: {
    baseUrl: "https://standalone-5vgm.onrender.com/",
  },
  myfatoorah: {
    baseUrl: `${PROXY}/https://apitest.myfatoorah.com/`,
    calls: {
      sendPayment: "v2/SendPayment",
      status: "v2/GetPaymentStatus",
      invoice: "v2/ExecutePayment",
      refund: "v2/MakeRefund",
      refundStatus: "v2/GetRefundStatus",
    },
  },
  delivery: {
    baseUrl: "https://backend.vizsoft.in/",
    calls: {
      token: "store-valley-stub",
      create: "create-delivery",
      track: "track-delivery",
      cancel: "cancel-delivery",
    },
  },
  countries: "https://restcountries.com/v3.1/name",
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

export const paymentCalls = [
  "Send",
  "Resend",
  "Verify",
  "SendSMS",
  "VerifySMS",
  "EmailSend",
  "Charge",
  "Status",
  "ChargeAPI",
  "StatusAPI",
  "UploadFileOrImage",
  "Invoice",
  "InvoiceStatus",
  "Execute",
  "MakeRefund",
  "GetRefundStatus",
  "GetAccessToken",
  "CreateDelivery",
  "TrackDelivery",
  "CancelDelivery",
  "CountryISO",
] as const;
