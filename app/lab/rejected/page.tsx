import { LabForm } from "../LabForm";
export default function Page() { return <LabForm endpoint="/api/lab/rejected" title="Rejected 400" description="The marker is sent to an endpoint that returns 400, so the auditor should classify this as SENT_BUT_REJECTED." />; }
