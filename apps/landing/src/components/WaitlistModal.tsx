import { useEffect, useRef, useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WaitlistModal({ isOpen, onClose }: WaitlistModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [career, setCareer] = useState("");
  const [useCase, setUseCase] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [emailError, setEmailError] = useState("");
  const [globalError, setGlobalError] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the element that opened the modal so focus can return there
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      firstInputRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  // Keyboard handler: Escape closes, Tab traps focus
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = overlayRef.current?.querySelectorAll<HTMLElement>(
        "button, input, [tabindex]:not([tabindex='-1'])"
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0] ?? null;
      const last = focusable[focusable.length - 1] ?? null;

      if (e.shiftKey) {
        if (first && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (last && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const validateEmail = (value: string): boolean => {
    if (!value.trim()) {
      setEmailError("El correo electrónico es obligatorio.");
      return false;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(value.trim())) {
      setEmailError("Introduce un correo electrónico válido.");
      return false;
    }
    setEmailError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validateEmail(email)) return;

    setFormState("submitting");
    setGlobalError("");

    const accessKey = (import.meta.env.VITE_WEB3FORMS_KEY as string | undefined)?.trim();

    if (!accessKey || accessKey === "your_access_key_here") {
      console.error(
        "[NoeticAI waitlist] VITE_WEB3FORMS_KEY is not set. Submissions are NOT being delivered.\n" +
          "Fix: register at https://web3forms.com with tomasizuel@gmail.com, then set the key in:\n" +
          "  • apps/landing/.env                  (local dev — restart `pnpm dev` after editing)\n" +
          "  • Vercel → Settings → Environment Variables (production)"
      );
      setFormState("error");
      setGlobalError(
        "El formulario aún no está conectado. Si eres el administrador, configura VITE_WEB3FORMS_KEY."
      );
      return;
    }

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: accessKey,
          email: email.trim(),
          name: name.trim() || undefined,
          career: career.trim() || undefined,
          use_case: useCase.trim() || undefined,
          subject: "NoeticAI waitlist signup",
          from_name: "NoeticAI Landing",
        }),
      });

      const data = (await response.json()) as { success: boolean; message?: string };

      if (data.success) {
        setFormState("success");
      } else {
        console.error("[NoeticAI waitlist] Web3Forms rejected the submission:", data);
        throw new Error(data.message ?? "Error desconocido");
      }
    } catch (err) {
      console.error("[NoeticAI waitlist] submission failed:", err);
      setFormState("error");
      setGlobalError("Algo salió mal. Por favor, inténtalo de nuevo.");
    }
  };

  const handleReset = () => {
    setFormState("idle");
    setGlobalError("");
    firstInputRef.current?.focus();
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-box">
        <button
          className="modal-close"
          onClick={onClose}
          ref={closeButtonRef}
          aria-label="Cerrar"
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>

        {formState === "success" ? (
          <div className="wl-success" aria-live="polite">
            <div className="wl-success-icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3>Solicitud recibida.</h3>
            <p>
              Te escribimos cuando se abra tu tanda. Mientras tanto, el mapa sigue
              incompleto.
            </p>
          </div>
        ) : (
          <>
            <div className="modal-eyebrow">Beta cerrada</div>
            <h2 className="modal-title" id="modal-title">
              Entrar a la beta cerrada de NoeticAI
            </h2>
            <p className="modal-sub">
              Estamos abriendo el acceso por tandas. Déjanos tus datos y te escribimos cuando te toque.
            </p>

            <form className="wl-form" onSubmit={handleSubmit} noValidate>
              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-name">
                  Nombre <span style={{ color: "var(--fg-faint)" }}>(opcional)</span>
                </label>
                <input
                  className="wl-input"
                  id="wl-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Tu nombre"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  ref={firstInputRef}
                  disabled={formState === "submitting"}
                />
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-career">
                  Carrera o área de estudio{" "}
                  <span style={{ color: "var(--fg-faint)" }}>(opcional)</span>
                </label>
                <input
                  className="wl-input"
                  id="wl-career"
                  type="text"
                  name="career"
                  placeholder="Filosofía, derecho, posgrado en historia…"
                  value={career}
                  onChange={(e) => setCareer(e.target.value)}
                  disabled={formState === "submitting"}
                />
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-use-case">
                  ¿Cómo planeas usarlo?{" "}
                  <span style={{ color: "var(--fg-faint)" }}>(opcional)</span>
                </label>
                <textarea
                  className="wl-input wl-textarea"
                  id="wl-use-case"
                  name="use_case"
                  rows={3}
                  placeholder="Auditar mis notas para los exámenes integrales, mapear mi tesis…"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  disabled={formState === "submitting"}
                  maxLength={500}
                />
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-email">
                  Correo electrónico{" "}
                  <span style={{ color: "var(--accent-soft)" }}>*</span>
                </label>
                <input
                  className={`wl-input${emailError ? " error" : ""}`}
                  id="wl-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  onBlur={() => {
                    if (email) validateEmail(email);
                  }}
                  aria-describedby={emailError ? "wl-email-error" : undefined}
                  aria-invalid={emailError ? "true" : "false"}
                  disabled={formState === "submitting"}
                  required
                />
                {emailError && (
                  <span
                    className="wl-error"
                    id="wl-email-error"
                    role="alert"
                    aria-live="polite"
                  >
                    {emailError}
                  </span>
                )}
              </div>

              <button
                className="wl-submit"
                type="submit"
                disabled={formState === "submitting"}
                aria-label={
                  formState === "submitting"
                    ? "Enviando, por favor espera"
                    : "Solicitar acceso a la beta cerrada"
                }
              >
                {formState === "submitting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  "Solicitar acceso a la beta"
                )}
              </button>

              {formState === "error" && (
                <div className="wl-global-error" aria-live="polite">
                  {globalError}{" "}
                  <button
                    type="button"
                    onClick={handleReset}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent-soft)",
                      fontFamily: "var(--sans)",
                      fontSize: "14px",
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Reintentar
                  </button>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
