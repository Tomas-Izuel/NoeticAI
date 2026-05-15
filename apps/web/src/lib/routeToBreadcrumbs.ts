import type { Subject } from "../api/subjects";

/**
 * Pure function — no hooks. Derives breadcrumb labels from the current pathname
 * and (optionally) the active subject. Table-driven, no regex.
 */
export function routeToBreadcrumbs(pathname: string, subject: Subject | null): string[] {
  const name = subject?.name ?? "—";

  if (pathname.startsWith("/audit/")) return ["Audit", name, "Coverage"];
  if (pathname.startsWith("/map/")) return ["Map", name, "Constellation"];
  if (pathname.startsWith("/concept/")) return ["Audit", name, "Concept"];
  if (pathname.startsWith("/note/")) return ["Notes", "Detail"];
  if (pathname.startsWith("/bibliography")) return ["Sources", name, "Bibliography"];
  if (pathname.startsWith("/plan")) return ["Account", "Plan & usage"];
  if (pathname.startsWith("/settings")) return ["Settings", "Account"];
  if (pathname.startsWith("/onboarding")) return ["Setup", "Connect"];

  if (pathname.startsWith("/dev/")) {
    const segment = pathname.split("/").filter(Boolean)[1] ?? "";
    return ["Dev", segment];
  }

  return [];
}
