import { Outlet, useNavigate, useLocation } from "react-router";
import { useState } from "react";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { HiOutlineChartBarSquare, HiOutlineBuildingStorefront, HiOutlineCreditCard, HiOutlineCog6Tooth, HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlineArrowRightOnRectangle } from "react-icons/hi2";
import { isAdminAuthenticated } from "../utils/admin-auth.server";
import { AdminPolarisProvider } from "../components/AdminPolarisProvider";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isAdminAuthenticated(request)) {
    return redirect("/admin-login");
  }
  return { authenticated: true };
};

const navItems = [
  { label: "Dashboard", path: "/admin", Icon: HiOutlineChartBarSquare },
  { label: "Merchants", path: "/admin/merchants", Icon: HiOutlineBuildingStorefront },
  { label: "Plans", path: "/admin/plans", Icon: HiOutlineCreditCard },
  { label: "Settings", path: "/admin/settings", Icon: HiOutlineCog6Tooth },
];

const SIDEBAR_OPEN = 240;
const SIDEBAR_COLLAPSED = 56;

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [collapsed, setCollapsed] = useState(false);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_OPEN;

  return (
    <AdminPolarisProvider>
      <div style={{ fontFamily: "Inter, -apple-system, system-ui, sans-serif", background: "#f6f6f7", minHeight: "100vh" }}>
        {/* Sidebar — custom dark nav (Polaris doesn't have this) */}
        <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: `${sidebarWidth}px`, background: "#0f172a", display: "flex", flexDirection: "column", zIndex: 10, transition: "width 0.2s ease", overflow: "hidden" }}>
          <div style={{ padding: collapsed ? "20px 12px" : "20px 16px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", minHeight: "72px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
              <div style={{ width: "32px", height: "32px", minWidth: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "14px" }}>U</div>
              {!collapsed && (
                <div style={{ whiteSpace: "nowrap" }}>
                  <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: "14px", lineHeight: 1.2 }}>UpsellHive</div>
                  <div style={{ color: "#64748b", fontSize: "11px" }}>Admin Panel</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button onClick={() => setCollapsed(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", lineHeight: 0, display: "flex", borderRadius: "6px" }} title="Collapse">
                <HiOutlineChevronLeft size={16} color="#64748b" />
              </button>
            )}
          </div>
          {collapsed && (
            <div style={{ padding: "12px 0", display: "flex", justifyContent: "center" }}>
              <button onClick={() => setCollapsed(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", lineHeight: 0, display: "flex", borderRadius: "6px" }} title="Expand">
                <HiOutlineChevronRight size={16} color="#64748b" />
              </button>
            </div>
          )}
          <nav style={{ padding: collapsed ? "8px" : "12px 8px", flex: 1 }}>
            {navItems.map((item) => {
              const active = (item.path === "/admin" && currentPath === "/admin") ||
                (item.path !== "/admin" && currentPath.startsWith(item.path));
              return (
                <a key={item.path} href="#" onClick={(e) => { e.preventDefault(); navigate(item.path); }} title={collapsed ? item.label : undefined}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: collapsed ? "10px 0" : "10px 12px", justifyContent: collapsed ? "center" : "flex-start", borderRadius: "8px", marginBottom: "2px", fontSize: "13px", fontWeight: active ? 600 : 400, color: active ? "#fff" : "#94a3b8", background: active ? "#1e293b" : "transparent", textDecoration: "none", transition: "all 0.15s ease", whiteSpace: "nowrap", overflow: "hidden" }}>
                  <item.Icon size={18} color={active ? "#fff" : "#94a3b8"} />
                  {!collapsed && item.label}
                </a>
              );
            })}
          </nav>
          <div style={{ padding: collapsed ? "8px" : "8px 8px 16px", borderTop: "1px solid #1e293b" }}>
            <form method="POST" action="/admin-logout">
              <button type="submit" title={collapsed ? "Logout" : undefined}
                style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: collapsed ? "10px 0" : "10px 12px", justifyContent: collapsed ? "center" : "flex-start", borderRadius: "8px", border: "none", background: "transparent", color: "#94a3b8", fontSize: "13px", cursor: "pointer", transition: "all 0.15s ease" }}>
                <HiOutlineArrowRightOnRectangle size={18} color="#94a3b8" />
                {!collapsed && "Logout"}
              </button>
            </form>
          </div>
        </div>

        {/* Main content */}
        <div style={{ marginLeft: `${sidebarWidth}px`, minHeight: "100vh", transition: "margin-left 0.2s ease" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 32px" }}>
            <Outlet />
          </div>
        </div>
      </div>
    </AdminPolarisProvider>
  );
}

export function ErrorBoundary() {
  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f6f7" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 8px" }}>Unauthorized</h1>
        <a href="/admin-login" style={{ color: "#6366f1" }}>Go to login</a>
      </div>
    </div>
  );
}
