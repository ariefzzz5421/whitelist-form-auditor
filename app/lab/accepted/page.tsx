import { LabForm } from "../LabForm";
export default function Page() { return <LabForm endpoint="/api/lab/accepted" title="Accepted 201" description="The marker is sent to an endpoint that returns 201, so the auditor should classify this as CONFIRMED_SENT." />; }
