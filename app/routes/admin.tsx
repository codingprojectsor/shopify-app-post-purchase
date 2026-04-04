import { Outlet, useLoaderData, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Super Admin layout — NOT embedded in Shopify.
 * Protected by ADMIN_SECRET env variable.
 * Access: /admin?key=YOUR_SECRET
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    throw new Response("ADMIN_SECRET not configured in environment", {
      status: 500,
    });
  }

  if (key !== secret) {
    throw new Response("Unauthorized — provide ?key=YOUR_ADMIN_SECRET", {
      status: 401,
    });
  }

  return { authenticated: true };
};

export default function AdminLayout() {
  const navigate = useNavigate();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f6f6f7", minHeight: "100vh" }}>
      {/* Top nav */}
      <div style={{ background: "#1a1a1a", color: "#fff", padding: "12px 24px", display: "flex", alignItems: "center", gap: "24px" }}>
        <strong style={{ fontSize: "16px" }}>Upsell App — Super Admin</strong>
        <nav style={{ display: "flex", gap: "16px", marginLeft: "auto" }}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate("/admin?key=" + getKey()); }} style={{ color: "#b5b5b5", textDecoration: "none" }}>
            Dashboard
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate("/admin/merchants?key=" + getKey()); }} style={{ color: "#b5b5b5", textDecoration: "none" }}>
            Merchants
          </a>
        </nav>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
        <Outlet />
      </div>
    </div>
  );
}

function getKey() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("key") || "";
}

export function ErrorBoundary() {
  return (
    <div style={{ fontFamily: "system-ui", padding: "40px", textAlign: "center" }}>
      <h1>401 — Unauthorized</h1>
      <p>Access this page with <code>/admin?key=YOUR_ADMIN_SECRET</code></p>
    </div>
  );
}
