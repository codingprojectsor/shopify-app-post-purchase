import { useLoaderData } from "react-router";
import { useState, useEffect, useCallback } from "react";
import type { ActionFunctionArgs } from "react-router";
import { getPlainPassword, updatePassword, clearAdminSessionCookie } from "../utils/admin-auth.server";
import { redirect } from "react-router";
import {
  Page, Card, Text, TextField, Button, Banner, Modal, Toast,
  BlockStack, InlineStack, FormLayout,
} from "@shopify/polaris";
import { ClipboardIcon, ViewIcon, HideIcon } from "@shopify/polaris-icons";

function validatePassword(pw: string | undefined): string | null {
  if (!pw) return "Password is required";
  if (pw.length < 8) return "At least 8 characters";
  if (!/[A-Z]/.test(pw)) return "At least 1 uppercase letter";
  if (!/[a-z]/.test(pw)) return "At least 1 lowercase letter";
  if (!/[0-9]/.test(pw)) return "At least 1 digit";
  if (!/[^A-Za-z0-9]/.test(pw)) return "At least 1 special character";
  return null;
}

export const loader = async () => {
  const password = await getPlainPassword();
  return { password };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "change_password") {
    const newPassword = (formData.get("newPassword") as string)?.trim();
    const validation = validatePassword(newPassword);
    if (validation) return { error: validation };
    await updatePassword(newPassword);
    // Clear session and force re-login with new password
    return redirect("/admin-login", {
      headers: { "Set-Cookie": clearAdminSessionCookie() },
    });
  }
  return {};
};

export default function AdminSettings() {
  const { password } = useLoaderData<typeof loader>();
  const [copied, setCopied] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newPw, setNewPw] = useState("");

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(password);
    setCopied(true);
  }, [password]);

  const rules = [
    { label: "8+ characters", pass: newPw.length >= 8 },
    { label: "1 uppercase (A-Z)", pass: /[A-Z]/.test(newPw) },
    { label: "1 lowercase (a-z)", pass: /[a-z]/.test(newPw) },
    { label: "1 digit (0-9)", pass: /[0-9]/.test(newPw) },
    { label: "1 special char (!@#$%)", pass: /[^A-Za-z0-9]/.test(newPw) },
  ];
  const allRulesPass = rules.every((r) => r.pass);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const fd = new FormData();
    fd.set("intent", "change_password");
    fd.set("newPassword", newPw);

    try {
      const res = await fetch("/admin/settings", { method: "POST", body: fd, redirect: "follow" });
      if (res.redirected) {
        // Password changed — redirected to login
        window.location.href = res.url;
        return;
      }
      const data = await res.json();
      if (data?.error) {
        setSaveError(data.error);
        setSaving(false);
      }
    } catch {
      setSaveError("Failed to update password");
      setSaving(false);
    }
  };

  return (
    <Page
      title="Settings"
      primaryAction={{ content: "Change Password", onAction: () => setModalOpen(true) }}
    >
      <BlockStack gap="400">
        {/* Current password */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingSm" as="h2">Admin Password</Text>
              <Text variant="bodySm" as="p" tone="subdued">
                Share this password with anyone who needs admin access at /admin-login
              </Text>
            </BlockStack>
            <TextField
              label="" labelHidden autoComplete="off"
              value={showPw ? password : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              readOnly
              suffix={
                <InlineStack gap="100" blockAlign="center">
                  <Button variant="plain" icon={showPw ? HideIcon : ViewIcon} onClick={() => setShowPw(!showPw)}
                    accessibilityLabel={showPw ? "Hide" : "Show"} />
                  <Button variant="plain" icon={ClipboardIcon} onClick={handleCopy}
                    accessibilityLabel="Copy" />
                </InlineStack>
              }
            />
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Toasts */}
      {copied && <Toast content="Copied to clipboard!" onDismiss={() => setCopied(false)} />}
      {saveError && <Toast content={saveError} error onDismiss={() => setSaveError(null)} />}

      {/* Change password modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setNewPw(""); }}
        title="Change Password"
        primaryAction={{
          content: saving ? "Updating..." : "Update Password",
          onAction: handleSave,
          loading: saving,
          disabled: !allRulesPass || saving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setModalOpen(false); setNewPw(""); } }]}
      >
        <Modal.Section>
          {saveError && (
            <div style={{ marginBottom: "16px" }}>
              <Banner tone="critical">{saveError}</Banner>
            </div>
          )}

          <FormLayout>
            <TextField
              label="New Password"
              type="text"
              value={newPw}
              onChange={setNewPw}
              placeholder="e.g. MyPass@2026"
              autoComplete="off"
              requiredIndicator
              disabled={saving}
              autoFocus
            />
          </FormLayout>

          {/* Live validation */}
          <div style={{ marginTop: "16px" }}>
            <BlockStack gap="100">
              {rules.map((r) => (
                <InlineStack key={r.label} gap="200" blockAlign="center">
                  <span style={{ color: !newPw ? "#94a3b8" : r.pass ? "#22c55e" : "#ef4444", fontSize: "14px" }}>
                    {!newPw ? "\u25CB" : r.pass ? "\u2713" : "\u2717"}
                  </span>
                  <Text variant="bodySm" as="span" tone={!newPw ? "subdued" : r.pass ? "success" : "critical"}>
                    {r.label}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </div>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
