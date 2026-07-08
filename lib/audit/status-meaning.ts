export interface StatusMeaning {
  code: string;
  title: string;
  group: "2xx success" | "3xx redirect" | "4xx client/rejection" | "5xx server error";
  generalMeaning: string;
  auditorMeaning: string;
  doesNotProve: string;
}

export const STATUS_CODE_LAB: StatusMeaning[] = [
  { code: "2xx", title: "Success", group: "2xx success", generalMeaning: "The server accepted and processed the HTTP request successfully.", auditorMeaning: "If a unique marker is present in the outbound request, this supports CONFIRMED_SENT.", doesNotProve: "It does not prove permanent database storage or later business approval." },
  { code: "3xx", title: "Redirect", group: "3xx redirect", generalMeaning: "The endpoint redirected the browser to another location.", auditorMeaning: "The auditor follows only safe public redirects and still requires a marker-bearing request.", doesNotProve: "It does not prove the redirected service stored the submitted data." },
  { code: "4xx", title: "Client / rejection", group: "4xx client/rejection", generalMeaning: "The server rejected the request because of validation, authorization, rate limits, or another client-side condition.", auditorMeaning: "If the marker left the browser, this is SENT_BUT_REJECTED.", doesNotProve: "It does not prove accepted submission, allowlist entry, or database persistence." },
  { code: "5xx", title: "Server error", group: "5xx server error", generalMeaning: "The target server or an upstream dependency failed while handling the request.", auditorMeaning: "If the marker left the browser, this is SENT_BUT_REJECTED because the submission reached a failing endpoint.", doesNotProve: "It does not prove the target ignored the request; only that the observed response was an error." },
];

export function getStatusMeaning(status: number): StatusMeaning {
  const family = Math.floor(status / 100);
  return STATUS_CODE_LAB.find((item) => item.code.startsWith(String(family))) || STATUS_CODE_LAB[3];
}
