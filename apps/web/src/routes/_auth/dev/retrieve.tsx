import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../../../api/client";

interface RetrieveResult {
  query: string;
  modelId: string;
  results: Array<{
    id: string;
    noteId: string;
    noteTitle: string;
    position: number;
    kind: string;
    text: string;
    similarity: number;
    distance: number;
  }>;
}

export const Route = createFileRoute("/_auth/dev/retrieve")({
  component: RetrievePage,
});

function RetrievePage() {
  const [q, setQ] = useState("");

  const search = useMutation({
    mutationFn: (query: string) =>
      apiFetch<RetrieveResult>(
        `/dev/retrieve?q=${encodeURIComponent(query)}&k=5`,
      ),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length === 0) return;
    search.mutate(q.trim());
  }

  return (
    <section style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Dev · Retrieve</h1>
      <p style={{ color: "#aaa" }}>
        Embeds the query with Cohere multilingual v3 on Bedrock and runs
        cosine top-k against <code>note_fragment_embeddings</code>.
      </p>

      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ej. coherentismo, regreso epistémico"
          style={{ flex: 1, padding: "8px 10px" }}
        />
        <button type="submit" disabled={search.isPending}>
          {search.isPending ? "…" : "Search"}
        </button>
      </form>

      {search.isError ? (
        <p style={{ color: "crimson" }}>{search.error.message}</p>
      ) : null}

      {search.data ? (
        <div>
          <p style={{ fontSize: 13, color: "#888" }}>
            model {search.data.modelId} · {search.data.results.length} hits
          </p>
          <ol style={{ paddingLeft: 20 }}>
            {search.data.results.map((r, i) => (
              <li
                key={r.id}
                style={{
                  marginBottom: 12,
                  paddingBottom: 12,
                  borderBottom: i === search.data!.results.length - 1 ? "none" : "1px solid #1a1a1a",
                }}
              >
                <div style={{ fontSize: 12, color: "#888" }}>
                  <strong>{r.noteTitle}</strong> · pos {r.position} · {r.kind} ·
                  similarity <strong>{r.similarity.toFixed(3)}</strong>
                </div>
                <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5 }}>
                  {r.text}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
