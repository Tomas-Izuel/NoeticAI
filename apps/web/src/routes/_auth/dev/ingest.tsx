import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { apiFetch } from "../../../api/client";
import { useAsyncJob } from "../../../lib/useAsyncJob";

interface IngestResult {
  subjectId: string;
  notesIngested: number;
  fragmentsAdded: number;
  fragmentsExisting: number;
  embeddingsAdded: number;
  embeddingsSkipped: number;
  modelId: string;
  durationMs: number;
}

interface FragmentRow {
  id: string;
  noteId: string;
  noteTitle: string;
  position: number;
  kind: string;
  text: string;
  modelId: string | null;
  dim: number | null;
}

export const Route = createFileRoute("/_auth/dev/ingest")({
  component: IngestPage,
});

function IngestPage() {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const trigger = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string; queue: string }>("/dev/ingest", {
        method: "POST",
        body: JSON.stringify({ source: "stub" }),
      }),
    onSuccess: (data) => setJobId(data.jobId),
  });

  const job = useAsyncJob<IngestResult>(jobId);
  const isDone = job.data?.state === "completed";
  const isFailed = job.data?.state === "failed";

  const fragments = useQuery({
    queryKey: ["dev", "fragments"],
    queryFn: () => apiFetch<{ fragments: FragmentRow[] }>("/dev/fragments"),
    enabled: isDone,
  });

  // Refresh the fragment table once the job finishes.
  if (isDone && fragments.data === undefined && !fragments.isFetching) {
    void queryClient.invalidateQueries({ queryKey: ["dev", "fragments"] });
  }

  return (
    <section style={{ maxWidth: 960, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Dev · Ingest</h1>
      <p style={{ color: "#aaa" }}>
        Fires the StubConnector pipeline: subjects + units + notes upserted,
        fragments derived, embeddings written via Cohere multilingual v3 on
        Bedrock.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending || (job.data?.state === "active")}
        >
          {trigger.isPending
            ? "queuing…"
            : job.data?.state === "active"
              ? "running…"
              : "Trigger ingest"}
        </button>
        {jobId ? (
          <span style={{ fontSize: 13, color: "#888" }}>
            job <code>{jobId.slice(0, 12)}…</code>{" "}
            <strong>{job.data?.state ?? "queued"}</strong>
          </span>
        ) : null}
      </div>

      {isFailed ? (
        <p style={{ color: "crimson" }}>
          ingest failed: {job.data?.failedReason ?? "unknown error"}
        </p>
      ) : null}

      {isDone && job.data?.result ? (
        <ResultBanner result={job.data.result} />
      ) : null}

      {fragments.data ? <FragmentTable rows={fragments.data.fragments} /> : null}
    </section>
  );
}

function ResultBanner({ result }: { result: IngestResult }) {
  return (
    <div
      style={{
        background: "#0e1a0e",
        border: "1px solid #2a4a2a",
        borderRadius: 6,
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <strong>Done in {result.durationMs} ms.</strong>{" "}
      {result.notesIngested} notes · {result.fragmentsAdded} new fragments ·{" "}
      {result.fragmentsExisting} unchanged · {result.embeddingsAdded} embeddings
      added · {result.embeddingsSkipped} skipped (cached).
      <br />
      <span style={{ color: "#888" }}>model {result.modelId}</span>
    </div>
  );
}

const columnHelper = createColumnHelper<FragmentRow>();
const columns = [
  columnHelper.accessor("noteTitle", { header: "Note" }),
  columnHelper.accessor("position", { header: "Pos", size: 50 }),
  columnHelper.accessor("kind", { header: "Kind", size: 80 }),
  columnHelper.accessor("text", {
    header: "Text",
    cell: (info) => {
      const t = info.getValue();
      return t.length > 140 ? `${t.slice(0, 140)}…` : t;
    },
  }),
  columnHelper.accessor("modelId", {
    header: "Model",
    cell: (info) => info.getValue() ?? "—",
  }),
  columnHelper.accessor("dim", {
    header: "Dim",
    size: 60,
    cell: (info) => info.getValue() ?? "—",
  }),
];

function FragmentTable({ rows }: { rows: FragmentRow[] }) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <p style={{ fontSize: 13, color: "#888" }}>{rows.length} fragments</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid #333",
                  }}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid #1a1a1a",
                    verticalAlign: "top",
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
