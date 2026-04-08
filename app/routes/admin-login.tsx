import { redirect, Form, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isAdminAuthenticated,
  verifyPassword,
  createAdminSessionCookie,
  ensureAdminPassword,
} from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // If already logged in, redirect to dashboard
  if (isAdminAuthenticated(request)) {
    return redirect("/admin");
  }
  // Ensure default password is seeded
  await ensureAdminPassword();
  return {};
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const password = formData.get("password") as string;

  if (!password) {
    return { error: "Password is required" };
  }

  const valid = await verifyPassword(password);
  if (!valid) {
    return { error: "Invalid password" };
  }

  // Set session cookie and redirect
  return redirect("/admin", {
    headers: {
      "Set-Cookie": createAdminSessionCookie(),
    },
  });
};

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const error = actionData && typeof actionData === "object" && "error" in actionData
    ? (actionData.error as string)
    : null;
  const isLoading = navigation.state === "submitting";

  return (
    <div style={{
      fontFamily: "Inter, -apple-system, system-ui, sans-serif",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    }}>
      <div style={{ width: "100%", maxWidth: "400px", padding: "0 24px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            width: "48px", height: "48px", borderRadius: "14px",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: "20px", marginBottom: "16px",
          }}>
            U
          </div>
          <h1 style={{ color: "#f1f5f9", fontSize: "22px", fontWeight: 700, margin: "0 0 4px" }}>
            UpsellHive Admin
          </h1>
          <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>
            Enter your admin password to continue
          </p>
        </div>

        {/* Login card */}
        <div style={{
          background: "#fff",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}>
          {error && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px",
              padding: "10px 14px", marginBottom: "20px", color: "#dc2626", fontSize: "13px",
              display: "flex", alignItems: "center", gap: "8px",
            }}>
              <span style={{ fontSize: "16px" }}>&#x26A0;</span>
              {error}
            </div>
          )}

          <Form method="POST">
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter admin password"
                  required
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "11px 44px 11px 14px",
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                    fontSize: "14px",
                    outline: "none",
                    color: "#0f172a",
                    boxSizing: "border-box",
                    transition: "border-color 0.15s ease",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "#94a3b8", fontSize: "12px", padding: "4px",
                  }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                border: "none",
                background: isLoading ? "#a5b4fc" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 600,
                cursor: isLoading ? "default" : "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </Form>
        </div>

        <p style={{ textAlign: "center", color: "#475569", fontSize: "11px", marginTop: "24px" }}>
          Contact your admin for the password
        </p>
      </div>
    </div>
  );
}
