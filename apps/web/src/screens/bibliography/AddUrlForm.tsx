import { useState, useRef, useEffect, type FC } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Icon } from "./icons";

const urlSchema = z.object({
  url: z.string().url("Enter a valid URL (https://…)"),
});

interface AddUrlFormProps {
  isPending: boolean;
  onSubmit: (url: string) => void;
}

export const AddUrlForm: FC<AddUrlFormProps> = ({ isPending, onSubmit }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const form = useForm({
    defaultValues: { url: "" },
    onSubmit: ({ value }) => {
      const result = urlSchema.safeParse(value);
      if (!result.success) return;
      onSubmit(result.data.url);
      form.reset();
      setOpen(false);
    },
  });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        className="btn btn-primary"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
      >
        <Icon name="link" size={13} />
        {" "}Add from URL
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 360,
            background: "var(--base)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            padding: "16px 18px",
            zIndex: 20,
            boxShadow: "var(--float)",
          }}
        >
          <div className="cap" style={{ marginBottom: 10 }}>Add source from URL</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="url"
              validators={{
                onChange: ({ value }) => {
                  const r = urlSchema.shape.url.safeParse(value);
                  return r.success ? undefined : r.error.issues[0]?.message;
                },
              }}
            >
              {(field) => (
                <div style={{ marginBottom: 12 }}>
                  <input
                    className="input"
                    placeholder="https://example.com/paper.pdf"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={isPending}
                    autoFocus
                  />
                  {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                    <p
                      className="t-xs"
                      style={{ color: "var(--red-fg)", marginTop: 5 }}
                      role="alert"
                    >
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={isPending}
              >
                {isPending ? "Adding…" : "Add source"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
