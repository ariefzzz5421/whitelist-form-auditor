import { LabForm } from "../LabForm";
export default function Page() { return <LabForm endpoint="/api/lab/server-error" title="Server error 500" description="The marker is sent to an endpoint that returns 500, so the auditor should classify this as SENT_BUT_REJECTED." />; }
