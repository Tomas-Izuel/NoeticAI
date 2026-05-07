import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ location }) => {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.status === 401) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
      });
    }
    if (!res.ok) {
      throw new Error(`auth check failed: ${res.status}`);
    }
  },
  component: () => <Outlet />,
});
