import { BugReportForm } from "@/components/bugs/bug-report-form";
import { reportPage } from "@/lib/bug-reports";

export const metadata = { title: "Report a bug · VASH" };

/** Linked as /report-a-bug?from=<path>, so the report records the page it's about. */
export default async function ReportBugPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-[560px] flex-col gap-3">
        <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Report a bug</h1>
        <p className="text-sm text-muted">
          Something not working the way it should? Tell us what happened. The more specific you are, the faster it can be fixed.
        </p>
      </div>
      <BugReportForm page={reportPage(typeof from === "string" ? from : undefined)} />
    </div>
  );
}
