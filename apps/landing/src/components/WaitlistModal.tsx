import { useEffect, useRef, useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WaitlistModal({ isOpen, onClose }: WaitlistModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
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
      // Move focus to first input after paint
      requestAnimationFrame(() => {
        firstInputRef.current?.focus();
      });
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

    const accessKey = import.meta.env.VITE_WEB3FORMS_KEY as string | undefined;

    if (!accessKey) {
      console.warn(
        "[NoeticAI waitlist] VITE_WEB3FORMS_KEY is not set. " +
          "Sign up at https://web3forms.com with tomasizuel@gmail.com and paste the key into apps/landing/.env as VITE_WEB3FORMS_KEY=..."
      );
      // Simulate success in dev so the page is testable
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      setFormState("success");
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
          subject: "NoeticAI waitlist signup",
          from_name: "NoeticAI Landing",
        }),
      });

      const data = (await response.json()) as { success: boolean; message?: string };

      if (data.success) {
        setFormState("success");
      } else {
        throw new Error(data.message ?? "Error desconocido");
      }
    } catch {
      setFormState("error");
      setGlobalError("Algo salió mal. Por favor, inténtalo de nuevo.");
    }
  };

  const handleReset = () => {
    setFormState("idle");
    setGlobalError("");
    requestAnimationFrame(() => {
      firstInputRef.current?.focus();
    });
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
            <h3>Estás en la lista.</h3>
            <p>
              Te escribiremos cuando NoeticAI abra. Mientras tanto, el mapa sigue
              incompleto.
            </p>
          </div>
        ) : (
          <>
            <div className="modal-eyebrow">Lista de espera</div>
            <h2 className="modal-title" id="modal-title">
              Sé el primero en auditar.
            </h2>
            <p className="modal-sub">
              NoeticAI está en desarrollo. Apúntate y te avisamos en cuanto abra.
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
                    : "Unirse a la lista de espera"
                }
              >
                {formState === "submitting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  "Unirme a la lista de espera"
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
