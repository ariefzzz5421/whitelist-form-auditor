export const DUMMY_WALLET = "0x000000000000000000000000000000000000dEaD";
export const DUMMY_TWITTER = "test_audit_123456";
export const DUMMY_EMAIL = "audit_waitlist_123456@example.com";
export const DUMMY_NAME = "Audit Test User";

export const SIGNAL_KEYS = [
  "fetch",
  "XMLHttpRequest",
  "axios",
  "supabase",
  "firebase",
  "firestore",
  "airtable",
  "formspree",
  "script.google.com",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "sendBeacon",
] as const;

export type SignalName = (typeof SIGNAL_KEYS)[number];

export type StaticVerdict =
  | "BACKEND_ENDPOINT_FOUND"
  | "LOCAL_ONLY"
  | "NO_SUBMISSION_DETECTED_OR_FAKE_UI"
  | "UNKNOWN";

export type LiveVerdict =
  | "DATA_SENT_TO_SERVER"
  | "LOCAL_ONLY"
  | "NO_SUBMISSION_DETECTED_OR_FAKE_UI"
  | "UNKNOWN";

export type DetectionSignals = Record<SignalName, boolean>;

export interface ExtractedInput {
  name: string;
  id: string;
  type: string;
  placeholder: string;
  autocomplete: string;
  required: boolean;
}

export interface ExtractedForm {
  index: number;
  action: string;
  actionResolved: string;
  method: string;
  inputs: ExtractedInput[];
  submitLabels: string[];
}

export interface StaticAuditReport {
  targetUrl: string;
  scannedAt: string;
  htmlBytes: number;
  hasForm: boolean;
  hasBackendEndpoint: boolean;
  usesLocalStorage: boolean;
  usesSupabaseOrFirebase: boolean;
  signals: DetectionSignals;
  forms: ExtractedForm[];
  verdict: StaticVerdict;
  summary: string;
}

export interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
  postDataPreview: string;
  containsDummyWallet: boolean;
  containsDummyTwitter: boolean;
  containsDummyEmail: boolean;
  containsDummyName: boolean;
  containsDummyData: boolean;
  timestamp: string;
}

export interface StorageEventCapture {
  area: "localStorage" | "sessionStorage" | "unknown";
  key: string;
  valuePreview: string;
  containsDummyWallet: boolean;
  containsDummyTwitter: boolean;
  containsDummyEmail: boolean;
  containsDummyName: boolean;
  containsDummyData: boolean;
  timestamp: number;
}

export interface LiveAuditReport {
  targetUrl: string;
  scannedAt: string;
  requests: CapturedRequest[];
  storageEvents: StorageEventCapture[];
  hasPostRequest: boolean;
  payloadContainsDummyWallet: boolean;
  payloadContainsDummyTwitter: boolean;
  payloadContainsDummyEmail: boolean;
  payloadContainsDummyName: boolean;
  payloadContainsDummyData: boolean;
  storageContainsDummyData: boolean;
  usesLocalStorage: boolean;
  walletFilled: boolean;
  twitterFilled: boolean;
  emailFilled: boolean;
  nameFilled: boolean;
  submitClicked: boolean;
  verdict: LiveVerdict;
  notes: string[];
}
