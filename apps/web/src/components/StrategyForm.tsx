import { useState, useId, useRef, useEffect } from "react";
import type {
  SerializedField,
  DiscoveryPayload,
  NotionDatabase,
  NotionPage,
  NotionPropertyType,
} from "../api/strategies";
import { useDatabaseSchema, usePropertyOptions } from "../api/strategies";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StrategyFormProps {
  schema: Record<string, SerializedField>;
  defaults: Record<string, string>;
  discovery: DiscoveryPayload;
  connectionId: string;
  onSubmit: (config: Record<string, string>) => Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

// Given a changed fieldKey and the full schema, collect all downstream field
// keys that depend on it (via dependsOn, dependsOnDatabase, or
// dependsOnProperty — indirect).
function getDependentKeys(
  changedKey: string,
  schema: Record<string, SerializedField>,
): string[] {
  const deps: string[] = [];
  for (const [k, f] of Object.entries(schema)) {
    if (
      (f.kind === "property" && f.dependsOn === changedKey) ||
      (f.kind === "select-option" && f.dependsOnDatabase === changedKey)
    ) {
      deps.push(k);
    }
  }
  return deps;
}

// ─── Icon glyph for Notion resources ─────────────────────────────────────────

function ResourceIcon({
  icon,
  size = 14,
}: {
  icon: NotionDatabase["icon"] | NotionPage["icon"];
  size?: number;
}) {
  if (!icon) return null;
  if (icon.kind === "emoji") {
    return (
      <span
        style={{ fontSize: size, lineHeight: 1, flexShrink: 0 }}
        aria-hidden="true"
      >
        {icon.value}
      </span>
    );
  }
  return (
    <img
      src={icon.value}
      alt=""
      style={{ width: size, height: size, borderRadius: 3, flexShrink: 0 }}
    />
  );
}

// ─── Color dot for select options ─────────────────────────────────────────────

const OPTION_COLORS: Record<string, string> = {
  blue: "#4a7cc9",
  green: "#4d8b6a",
  red: "#a8221b",
  yellow: "#c08a3e",
  orange: "#c06a3e",
  purple: "#7a5cbf",
  pink: "#bf5c8f",
  gray: "#5e5e5e",
  brown: "#8b6a4d",
};

function OptionDot({ color }: { color?: string }) {
  const c = color ? (OPTION_COLORS[color] ?? "var(--fg-whisper)") : "var(--fg-whisper)";
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: c,
        flexShrink: 0,
        display: "inline-block",
      }}
      aria-hidden="true"
    />
  );
}

// ─── Custom combobox/select for databases + pages ─────────────────────────────

interface ResourceSelectProps<T extends { id: string; title: string; icon: NotionDatabase["icon"] }> {
  id: string;
  items: T[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

function ResourceSelect<T extends { id: string; title: string; icon: NotionDatabase["icon"] }>({
  id,
  items,
  value,
  onChange,
  disabled,
  placeholder = "Select…",
  emptyMessage,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: ResourceSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = items.find((i) => i.id === value) ?? null;
  const showFilter = items.length > 5;

  const filtered = showFilter && filter.trim()
    ? items.filter((i) =>
        i.title.toLowerCase().includes(filter.toLowerCase()) ||
        i.id.toLowerCase().includes(filter.toLowerCase()),
      )
    : items;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Esc
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setFilter("");
    }
  };

  const handleSelect = (item: T) => {
    onChange(item.id);
    setOpen(false);
    setFilter("");
  };

  if (items.length === 0 && emptyMessage) {
    return (
      <div
        style={{
          padding: "10px 12px",
          background: "var(--recessed)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          fontSize: 12.5,
          color: "var(--fg-faint)",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative" }}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((p) => !p);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 30,
          padding: "0 10px",
          background: "var(--recessed)",
          border: "none",
          borderRadius: 4,
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: ariaInvalid
            ? "var(--inset-sm), inset 0 0 0 1px var(--accent-soft)"
            : "var(--inset-sm), inset 0 0 0 1px var(--line)",
          opacity: disabled ? 0.5 : 1,
          textAlign: "left",
        }}
      >
        {selected ? (
          <>
            <ResourceIcon icon={selected.icon} size={13} />
            <span
              className="t-sm"
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {selected.title}
            </span>
            <span
              className="mono t-xs"
              style={{ color: "var(--fg-faint)", flexShrink: 0 }}
            >
              {selected.id.slice(-6)}
            </span>
          </>
        ) : (
          <span className="t-sm" style={{ color: "var(--fg-faint)" }}>
            {placeholder}
          </span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--fg-faint)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, marginLeft: "auto" }}
          aria-hidden="true"
        >
          <polyline points="2,3.5 5,6.5 8,3.5" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--raised)",
            border: "1px solid var(--line-strong)",
            borderRadius: 5,
            zIndex: 200,
            boxShadow: "var(--float)",
            overflow: "hidden",
          }}
        >
          {showFilter && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
              <input
                ref={inputRef}
                className="input"
                type="text"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ height: 26, fontSize: 12.5 }}
              />
            </div>
          )}
          <div
            id={listboxId}
            role="listbox"
            style={{ maxHeight: 220, overflowY: "auto" }}
          >
            {filtered.length === 0 ? (
              <div
                className="t-xs t-faint"
                style={{ padding: "10px 12px", textAlign: "center" }}
              >
                No matches
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  onClick={() => handleSelect(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    background: item.id === value ? "var(--accent-tint)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <ResourceIcon icon={item.icon} size={13} />
                  <span
                    className="t-sm"
                    style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {item.title}
                  </span>
                  <span className="mono t-xs" style={{ color: "var(--fg-faint)", flexShrink: 0 }}>
                    {item.id.slice(-6)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Property dropdown (single-dependent on database) ────────────────────────

interface PropertySelectProps {
  id: string;
  connectionId: string;
  dbId: string | null;
  allowedTypes: NotionPropertyType[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  fieldDefault?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

function PropertySelect({
  id,
  connectionId,
  dbId,
  allowedTypes,
  value,
  onChange,
  disabled,
  fieldDefault,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: PropertySelectProps) {
  const schema = useDatabaseSchema(connectionId, dbId);

  const properties = (schema.data?.properties ?? []).filter(
    (p) => allowedTypes.length === 0 || allowedTypes.includes(p.type),
  );

  // Auto-select default when schema loads and no value is set
  useEffect(() => {
    if (!value && fieldDefault && schema.data) {
      const match = properties.find((p) => p.name === fieldDefault);
      if (match) onChange(match.name);
    }
  // Only run when schema loads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.data]);

  if (!dbId) {
    return (
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--recessed)",
          borderRadius: 4,
          boxShadow: "var(--inset-sm), inset 0 0 0 1px var(--line)",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <span className="t-sm" style={{ color: "var(--fg-faint)" }}>
          Pick a database first
        </span>
      </div>
    );
  }

  if (schema.isLoading) {
    return (
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          background: "var(--recessed)",
          borderRadius: 4,
          boxShadow: "var(--inset-sm), inset 0 0 0 1px var(--line)",
        }}
      >
        <Spinner size={12} />
        <span className="t-xs t-faint">Loading properties…</span>
      </div>
    );
  }

  return (
    <select
      id={id}
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || schema.isLoading}
      aria-describedby={ariaDescribedby}
      aria-invalid={ariaInvalid}
      style={{
        height: 30,
        paddingRight: 32,
        appearance: "none",
        backgroundImage:
          `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpolyline points='2,3.5 5,6.5 8,3.5' fill='none' stroke='%235e5e5e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
    >
      <option value="">— Select property —</option>
      {properties.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name} · {p.type}
        </option>
      ))}
    </select>
  );
}

// ─── Select-option dropdown (doubly-dependent) ────────────────────────────────

interface SelectOptionFieldProps {
  id: string;
  connectionId: string;
  dbId: string | null;
  propName: string | null;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  fieldDefault?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

function SelectOptionField({
  id,
  connectionId,
  dbId,
  propName,
  value,
  onChange,
  disabled,
  fieldDefault,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: SelectOptionFieldProps) {
  const options = usePropertyOptions(connectionId, dbId, propName);

  useEffect(() => {
    if (!value && fieldDefault && options.data) {
      const match = options.data.options.find((o) => o.value === fieldDefault);
      if (match) onChange(match.value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data]);

  const isDisabled = !dbId || !propName;

  if (isDisabled) {
    return (
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--recessed)",
          borderRadius: 4,
          boxShadow: "var(--inset-sm), inset 0 0 0 1px var(--line)",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <span className="t-sm" style={{ color: "var(--fg-faint)" }}>
          {!dbId ? "Pick a database first" : "Pick a property first"}
        </span>
      </div>
    );
  }

  if (options.isLoading) {
    return (
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          background: "var(--recessed)",
          borderRadius: 4,
          boxShadow: "var(--inset-sm), inset 0 0 0 1px var(--line)",
        }}
      >
        <Spinner size={12} />
        <span className="t-xs t-faint">Loading options…</span>
      </div>
    );
  }

  const opts = options.data?.options ?? [];

  return (
    <div style={{ position: "relative" }}>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        style={{
          height: 30,
          paddingRight: 32,
          appearance: "none",
          backgroundImage:
            `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpolyline points='2,3.5 5,6.5 8,3.5' fill='none' stroke='%235e5e5e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 10px center",
        }}
      >
        <option value="">— Select option —</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/* Overlay color dots (not possible inside <select> — shown as legend below) */}
      {value && opts.find((o) => o.value === value)?.color && (
        <OptionDot
          color={opts.find((o) => o.value === value)?.color}
        />
      )}
    </div>
  );
}

// ─── Enum radio list ──────────────────────────────────────────────────────────

interface EnumFieldProps {
  id: string;
  options: { value: string; label: string; description?: string }[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

function EnumField({ id, options, value, onChange, disabled }: EnumFieldProps) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 1 }}
      role="radiogroup"
      aria-labelledby={`${id}-label`}
    >
      {options.map((opt, idx) => {
        const optId = `${id}-${idx}`;
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            htmlFor={optId}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "9px 12px",
              background: checked ? "var(--accent-tint)" : "transparent",
              border: `1px solid ${checked ? "var(--accent-deep)" : "var(--line)"}`,
              borderRadius: 4,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "background 120ms, border-color 120ms",
            }}
          >
            <input
              id={optId}
              type="radio"
              name={id}
              value={opt.value}
              checked={checked}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              style={{ marginTop: 1, flexShrink: 0, accentColor: "var(--accent-soft)" }}
            />
            <div>
              <div className="t-sm" style={{ color: checked ? "var(--fg)" : "var(--fg-muted)" }}>
                {opt.label}
              </div>
              {opt.description && (
                <div className="t-xs t-faint italic" style={{ marginTop: 2, lineHeight: 1.4 }}>
                  {opt.description}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${size <= 12 ? 1.5 : 2}px solid var(--fg-whisper)`,
        borderTopColor: "var(--accent-soft)",
        borderRadius: "50%",
        animation: "sf-spin 0.8s linear infinite",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

// ─── Field-level error ────────────────────────────────────────────────────────

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <div
      id={id}
      role="alert"
      style={{
        marginTop: 5,
        fontSize: 12,
        color: "#c8665b",
        display: "flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="5" />
        <line x1="6" y1="3.5" x2="6" y2="6.5" />
        <circle cx="6" cy="8.5" r="0.7" fill="currentColor" stroke="none" />
      </svg>
      {message}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StrategyForm({
  schema,
  defaults,
  discovery,
  connectionId,
  onSubmit,
  submitLabel = "Continue",
  submitting = false,
}: StrategyFormProps) {
  const entries = Object.entries(schema);
  const formId = useId();

  // Values map: seeded from defaults + field.default
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [key, field] of entries) {
      initial[key] = defaults[key] ?? ("default" in field ? (field.default ?? "") : "");
    }
    return initial;
  });

  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const [key, field] of entries) {
      if (field.required && !(values[key] ?? "").trim()) {
        errs[key] = `${field.label} is required.`;
      }
    }
    return errs;
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };

      // Cascading reset: clear dependent fields when a database/page changes
      const field = schema[key];
      if (field && (field.kind === "database" || field.kind === "page")) {
        for (const depKey of getDependentKeys(key, schema)) {
          next[depKey] = "";
        }
      }

      return next;
    });

    // Clear field error as user edits
    if (touched && errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    // Build config: trim, omit empty optional fields
    const config: Record<string, string> = {};
    for (const [key, field] of entries) {
      const trimmed = (values[key] ?? "").trim();
      if (trimmed) {
        config[key] = trimmed;
      } else if (field.required) {
        config[key] = trimmed;
      }
    }

    await onSubmit(config);
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {entries.map(([key, field]) => {
          const errorId = `${formId}-${key}-err`;
          const inputId = `${formId}-${key}`;
          const error = touched ? (errors[key] ?? null) : null;
          const hasError = !!error;

          return (
            <div key={key}>
              <label
                htmlFor={field.kind === "enum" ? undefined : inputId}
                id={field.kind === "enum" ? `${inputId}-label` : undefined}
                style={{ display: "block", marginBottom: 6 }}
              >
                <span className="cap-sm" style={{ color: "var(--fg-faint)" }}>
                  {field.label}
                  {field.required && (
                    <span
                      style={{ color: "var(--accent-soft)", marginLeft: 3 }}
                      aria-label="required"
                    >
                      *
                    </span>
                  )}
                </span>
              </label>

              {/* Help text */}
              {field.help && (
                <div
                  className="t-xs t-faint italic"
                  style={{ marginBottom: 6, lineHeight: 1.4 }}
                >
                  {field.help}
                </div>
              )}

              {/* Field renderer */}
              {field.kind === "text" && (
                <input
                  id={inputId}
                  className="input"
                  type="text"
                  value={values[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  disabled={submitting}
                  placeholder={field.default ?? ""}
                  aria-describedby={hasError ? errorId : undefined}
                  aria-invalid={hasError}
                  style={hasError ? { boxShadow: "var(--inset-sm), inset 0 0 0 1px var(--accent-soft)" } : undefined}
                />
              )}

              {field.kind === "database" && (
                <ResourceSelect
                  id={inputId}
                  items={discovery.databases}
                  value={values[key] ?? ""}
                  onChange={(v) => handleChange(key, v)}
                  disabled={submitting}
                  placeholder="Select a database…"
                  emptyMessage="No databases visible — share a database with the integration in Notion, then click Re-discover."
                  aria-describedby={hasError ? errorId : undefined}
                  aria-invalid={hasError}
                />
              )}

              {field.kind === "page" && (
                <ResourceSelect
                  id={inputId}
                  items={discovery.pages}
                  value={values[key] ?? ""}
                  onChange={(v) => handleChange(key, v)}
                  disabled={submitting}
                  placeholder="Select a page…"
                  emptyMessage="No pages visible — share a page with the integration in Notion, then click Re-discover."
                  aria-describedby={hasError ? errorId : undefined}
                  aria-invalid={hasError}
                />
              )}

              {field.kind === "property" && (
                <PropertySelect
                  id={inputId}
                  connectionId={connectionId}
                  dbId={values[field.dependsOn] ?? null}
                  allowedTypes={field.propertyTypes}
                  value={values[key] ?? ""}
                  onChange={(v) => handleChange(key, v)}
                  disabled={submitting}
                  fieldDefault={field.default}
                  aria-describedby={hasError ? errorId : undefined}
                  aria-invalid={hasError}
                />
              )}

              {field.kind === "select-option" && (
                <SelectOptionField
                  id={inputId}
                  connectionId={connectionId}
                  dbId={values[field.dependsOnDatabase] ?? null}
                  propName={values[field.dependsOnProperty] ?? null}
                  value={values[key] ?? ""}
                  onChange={(v) => handleChange(key, v)}
                  disabled={submitting}
                  fieldDefault={field.default}
                  aria-describedby={hasError ? errorId : undefined}
                  aria-invalid={hasError}
                />
              )}

              {field.kind === "enum" && (
                <EnumField
                  id={inputId}
                  options={field.options}
                  value={values[key] ?? (field.default ?? "")}
                  onChange={(v) => handleChange(key, v)}
                  disabled={submitting}
                />
              )}

              {error && <FieldError id={errorId} message={error} />}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>

      <style>{`
        @keyframes sf-spin { to { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
}
