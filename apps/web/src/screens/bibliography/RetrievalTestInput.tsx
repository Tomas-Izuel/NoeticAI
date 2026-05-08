import { useState, useEffect, useRef, type FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { runRetrieve } from "../../api/sources";
import { Icon } from "./icons";

interface RetrievalTestInputProps {
  subjectId: string;
}

export const RetrievalTestInput: FC<RetrievalTestInputProps> = ({ subjectId }) => {
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 300 ms debounce
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [inputValue]);

  const retrieveQ = useQuery({
    queryKey: ["sources", "retrieve", subjectId, debouncedQuery],
    queryFn: () => runRetrieve(subjectId, debouncedQuery),
    enabled: debouncedQuery.length >= 3,
    staleTime: 60_000,
  });

  return (
    <div>
      <div className="cap" style={{ marginBottom: 10 }}>
        Retrieval test
      </div>
      <div className="search" style={{ marginBottom: 12 }}>
        <Icon name="search" size={13} />
        <input
          placeholder="Type a query to test retrieval…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>

      {retrieveQ.isFetching && (
        <p className="t-xs t-faint" style={{ marginBottom: 8 }}>
          Searching…
        </p>
      )}

      {retrieveQ.isError && (
        <p className="t-xs" style={{ color: "var(--red-fg)", marginBottom: 8 }}>
          Retrieval failed. Is the source indexed?
        </p>
      )}

      {retrieveQ.data && retrieveQ.data.results.length === 0 && debouncedQuery.length >= 3 && (
        <p className="t-xs t-faint" style={{ fontStyle: "italic", marginBottom: 8 }}>
          No matching passages found.
        </p>
      )}

      {retrieveQ.data &&
        retrieveQ.data.results.map((r, i) => (
          <div
            key={r.id}
            style={{
              padding: "10px 12px",
              background: "var(--elevated)",
              borderRadius: 4,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)" }}>
                #{i + 1}
              </span>
              <span className="t-xs t-muted" style={{ flex: 1, minWidth: 0 }}>
                {r.sourceTitle}
                {r.pagesLabel && (
                  <span style={{ color: "var(--fg-faint)" }}> · {r.pagesLabel}</span>
                )}
              </span>
              {/* Similarity bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 3,
                    background: "var(--recessed)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.round(r.similarity * 100)}%`,
                      background: "var(--green)",
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)" }}>
                  {Math.round(r.similarity * 100)}%
                </span>
              </div>
            </div>
            <p
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--fg-muted)",
                margin: 0,
                fontStyle: "italic",
                // 3-line clamp
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {r.text}
            </p>
          </div>
        ))}
    </div>
  );
};
