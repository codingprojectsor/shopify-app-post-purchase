import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { logger } from "../utils/logger.server";
import {
  Page, Card, Text, Button, Modal, Popover, ActionList, Toast,
  BlockStack, InlineStack, InlineGrid, TextField, Checkbox,
  FormLayout, Banner, IndexTable, IndexFilters, Select,
  useSetIndexFiltersMode, Badge,
} from "@shopify/polaris";
import type { TabProps } from "@shopify/polaris";
import { MenuHorizontalIcon, EditIcon, HideIcon, ViewIcon, DeleteIcon } from "@shopify/polaris-icons";
import { formatPlanPrice } from "../utils/format";

const log = logger.for("admin.plans");

export const loader = async () => {
  const plans = await db.plan.findMany({ orderBy: { price: "asc" } });
  const subscriptions = await db.subscription.groupBy({ by: ["plan"], _count: { plan: true } });
  const subCounts: Record<string, number> = {};
  for (const s of subscriptions) subCounts[s.plan] = s._count.plan;
  return { plans, subCounts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create" || intent === "update") {
    const id = formData.get("id") as string | null;
    const data = {
      name: formData.get("name") as string,
      slug: (formData.get("slug") as string).toLowerCase().replace(/[^a-z0-9-]/g, ""),
      price: parseFloat(formData.get("price") as string) || 0,
      trialDays: parseInt(formData.get("trialDays") as string) || 0,
      maxOffers: parseInt(formData.get("maxOffers") as string) || 2,
      abTesting: formData.get("abTesting") === "on",
      analytics: formData.get("analytics") === "on",
      customBranding: formData.get("customBranding") === "on",
      prioritySupport: formData.get("prioritySupport") === "on",
      scheduledOffers: formData.get("scheduledOffers") === "on",
      funnelChaining: formData.get("funnelChaining") === "on",
      csvExport: formData.get("csvExport") === "on",
      isActive: formData.get("isActive") === "on" || formData.get("isActive") === "active",
      sortOrder: parseInt(formData.get("sortOrder") as string) || 0,
    };

    try {
      if (intent === "update" && id) {
        await db.plan.update({ where: { id }, data });
        log.info(`Plan updated: ${data.name}`, { id, slug: data.slug });
      } else {
        const existing = await db.plan.findUnique({ where: { slug: data.slug } });
        if (existing) return { error: `Slug "${data.slug}" already exists` };
        await db.plan.create({ data });
        log.info(`Plan created: ${data.name}`, { slug: data.slug });
      }
    } catch (err: any) {
      log.error("Plan save failed", { error: err?.message, code: err?.code });
      if (err?.code === "P2002") return { error: `Slug "${data.slug}" already exists` };
      return { error: err?.message || "Failed to save" };
    }
    return { success: true };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    if (!id) return { error: "Missing plan ID" };
    const plan = await db.plan.findUnique({ where: { id } });
    if (!plan) return { error: "Plan not found — it may have been already deleted" };
    if (plan.slug === "free") return { error: "Cannot delete the Free plan" };
    const subs = await db.subscription.count({ where: { plan: plan.slug } });
    if (subs > 0) return { error: `${subs} merchant(s) on this plan. Move them first.` };
    try {
      await db.plan.delete({ where: { id } });
      log.info(`Plan deleted: ${plan.name}`, { id });
    } catch (err: any) {
      log.error("Plan delete failed", { error: err?.message, id });
      return { error: `Failed to delete: ${err?.message || "Unknown error"}` };
    }
    return { success: true };
  }

  if (intent === "toggle") {
    const id = formData.get("id") as string;
    const plan = await db.plan.findUnique({ where: { id } });
    if (plan) {
      await db.plan.update({ where: { id }, data: { isActive: !plan.isActive } });
      log.info(`Plan toggled: ${plan.name} -> ${!plan.isActive ? "active" : "hidden"}`);
    }
    return { success: true };
  }

  return { success: false };
};

// --- Action menu per row ---
function PlanActions({ plan, onEdit, onToggle, onDelete, busy }: {
  plan: any; onEdit: () => void; onToggle: () => void; onDelete: () => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      active={open}
      activator={
        <Button variant="plain" icon={MenuHorizontalIcon} onClick={() => setOpen(!open)}
          accessibilityLabel="Actions" />
      }
      onClose={() => setOpen(false)}
    >
      <ActionList
        items={[
          { content: "Edit", icon: EditIcon, onAction: () => { setOpen(false); onEdit(); } },
          {
            content: plan.isActive ? "Hide from merchants" : "Show to merchants",
            icon: plan.isActive ? HideIcon : ViewIcon,
            onAction: () => { setOpen(false); onToggle(); },
            disabled: busy,
          },
          ...(plan.slug !== "free" ? [{
            content: "Delete",
            icon: DeleteIcon,
            destructive: true as const,
            onAction: () => { setOpen(false); onDelete(); },
          }] : []),
        ]}
      />
    </Popover>
  );
}

export default function AdminPlans() {
  const { plans, subCounts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const [modalOpen, setModalOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", slug: "", price: "0", trialDays: "3", maxOffers: "2",
    abTesting: false, analytics: false, customBranding: false, prioritySupport: false,
    scheduledOffers: false, funnelChaining: false, csvExport: false, isActive: true,
  });

  const isSaving = saveFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

  // Handle save results
  const lastSaveDataRef = useRef<unknown>(null);
  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
    if (saveFetcher.data === lastSaveDataRef.current) return;
    lastSaveDataRef.current = saveFetcher.data;
    const data = saveFetcher.data as any;
    if (data.error) { setError(data.error); return; }
    if (data.success) {
      setModalOpen(false);
      setError(null);
      setSuccess(editPlan ? "Plan updated" : "Plan created");
      setTimeout(() => setSuccess(null), 3000);
    }
  }, [saveFetcher.state, saveFetcher.data, editPlan]);

  // Handle delete results
  const lastDeleteDataRef = useRef<unknown>(null);
  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    if (deleteFetcher.data === lastDeleteDataRef.current) return;
    lastDeleteDataRef.current = deleteFetcher.data;
    const data = deleteFetcher.data as any;
    if (data.error) { setError(data.error); setDeleteTarget(null); return; }
    if (data.success) {
      setDeleteTarget(null);
      setSuccess("Plan deleted");
      setTimeout(() => setSuccess(null), 3000);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  const openCreate = useCallback(() => {
    setEditPlan(null);
    setForm({ name: "", slug: "", price: "0", trialDays: "3", maxOffers: "2", abTesting: false, analytics: false, customBranding: false, prioritySupport: false, scheduledOffers: false, funnelChaining: false, csvExport: false, isActive: true });
    setError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((plan: any) => {
    setEditPlan(plan);
    setForm({
      name: plan.name, slug: plan.slug, price: String(plan.price), trialDays: String(plan.trialDays),
      maxOffers: String(plan.maxOffers),
      abTesting: plan.abTesting, analytics: plan.analytics, customBranding: plan.customBranding,
      prioritySupport: plan.prioritySupport, scheduledOffers: plan.scheduledOffers,
      funnelChaining: plan.funnelChaining, csvExport: plan.csvExport, isActive: plan.isActive,
    });
    setError(null);
    setModalOpen(true);
  }, []);

  const handleSave = () => {
    setError(null);
    const fd: Record<string, string> = {
      intent: editPlan ? "update" : "create",
      name: form.name, slug: form.slug, price: form.price,
      trialDays: form.trialDays, maxOffers: form.maxOffers,
      isActive: form.isActive ? "active" : "hidden",
    };
    if (editPlan) fd.id = editPlan.id;
    if (form.abTesting) fd.abTesting = "on";
    if (form.analytics) fd.analytics = "on";
    if (form.customBranding) fd.customBranding = "on";
    if (form.prioritySupport) fd.prioritySupport = "on";
    if (form.scheduledOffers) fd.scheduledOffers = "on";
    if (form.funnelChaining) fd.funnelChaining = "on";
    if (form.csvExport) fd.csvExport = "on";
    saveFetcher.submit(fd, { method: "POST" });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setError(null);
    deleteFetcher.submit({ intent: "delete", id: deleteTarget.id }, { method: "POST" });
  };

  const handleToggle = (id: string) => {
    toggleFetcher.submit({ intent: "toggle", id }, { method: "POST" });
  };

  const allPlans = plans as any[];
  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { mode, setMode } = useSetIndexFiltersMode();
  const handleQueryChange = useCallback((v: string) => setQueryValue(v), []);
  const handleQueryClear = useCallback(() => setQueryValue(""), []);

  const filteredPlans = allPlans.filter((p: any) => {
    const matchesSearch = !queryValue || p.name.toLowerCase().includes(queryValue.toLowerCase()) || p.slug.toLowerCase().includes(queryValue.toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? p.isActive : !p.isActive);
    return matchesSearch && matchesStatus;
  });

  const tabs: TabProps[] = [
    { id: "all", content: `All (${allPlans.length})`, onAction: () => setStatusFilter("all") },
    { id: "active", content: `Active (${allPlans.filter((p: any) => p.isActive).length})`, onAction: () => setStatusFilter("active") },
    { id: "hidden", content: `Hidden (${allPlans.filter((p: any) => !p.isActive).length})`, onAction: () => setStatusFilter("hidden") },
  ];
  const selectedTab = statusFilter === "all" ? 0 : statusFilter === "active" ? 1 : 2;

  return (
    <Page title="Plans & Pricing" primaryAction={{ content: "+ Add Plan", onAction: openCreate }}>
      <BlockStack gap="400">
        {/* Toasts rendered at bottom */}

        {/* Subscriber overview */}
        <InlineGrid columns={Math.min(allPlans.length || 1, 4)} gap="400">
          {allPlans.map((plan: any) => (
            <Card key={plan.id}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: plan.isActive ? "#22c55e" : "#cbd5e1" }} />
                  <Text variant="bodySm" as="span" tone="subdued">{plan.name}</Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="baseline">
                  <Text variant="headingXl" as="p">{String(subCounts[plan.slug] || 0)}</Text>
                  <Text variant="bodySm" as="span" tone="subdued">subs</Text>
                </InlineStack>
                <Text variant="bodySm" as="span" tone="subdued">
                  {formatPlanPrice(plan.price)}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {/* Plans table with IndexTable */}
        <Card padding="0">
          <IndexFilters
            queryValue={queryValue}
            queryPlaceholder="Search plans..."
            onQueryChange={handleQueryChange}
            onQueryClear={handleQueryClear}
            tabs={tabs}
            selected={selectedTab}
            onSelect={(i) => setStatusFilter(["all", "active", "hidden"][i])}
            filters={[]}
            onClearAll={handleQueryClear}
            mode={mode}
            setMode={setMode}
            cancelAction={{ onAction: () => {} }}
          />
          <IndexTable
            resourceName={{ singular: "plan", plural: "plans" }}
            itemCount={filteredPlans.length}
            headings={[
              { title: "Plan" },
              { title: "Price" },
              { title: "Trial" },
              { title: "Limits" },
              { title: "Features" },
              { title: "Subs" },
              { title: "Status" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {filteredPlans.map((plan: any, i: number) => {
              const flags = [
                plan.abTesting && "A/B", plan.analytics && "Analytics",
                plan.customBranding && "Branding", plan.funnelChaining && "Funnels",
                plan.scheduledOffers && "Schedule", plan.csvExport && "CSV",
                plan.prioritySupport && "Priority",
              ].filter(Boolean) as string[];

              return (
                <IndexTable.Row id={plan.id} key={plan.id} position={i}>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text variant="bodyMd" as="span" fontWeight="semibold">{plan.name}</Text>
                      <Text variant="bodySm" as="span" tone="subdued">{plan.slug}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span" fontWeight="semibold">
                      {formatPlanPrice(plan.price)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{`${plan.trialDays}d`}</IndexTable.Cell>
                  <IndexTable.Cell>{plan.maxOffers === -1 ? "Unlimited" : `${plan.maxOffers} offers`}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100" wrap>
                      {flags.length > 0 ? (
                        <>
                          {flags.slice(0, 2).map((f) => <Badge key={f} tone="info">{f}</Badge>)}
                          {flags.length > 2 && <Text variant="bodySm" as="span" tone="subdued">{`+${flags.length - 2} more`}</Text>}
                        </>
                      ) : (
                        <Text variant="bodySm" as="span" tone="subdued">Basic</Text>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span" fontWeight="semibold">{String(subCounts[plan.slug] || 0)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={plan.isActive ? "success" : undefined}>
                      {plan.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <PlanActions
                      plan={plan}
                      busy={toggleFetcher.state !== "idle"}
                      onEdit={() => openEdit(plan)}
                      onToggle={() => handleToggle(plan.id)}
                      onDelete={() => setDeleteTarget(plan)}
                    />
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        </Card>
      </BlockStack>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editPlan ? `Edit: ${editPlan.name}` : "Create New Plan"}
        primaryAction={{
          content: isSaving ? "Saving..." : editPlan ? "Update Plan" : "Create Plan",
          onAction: handleSave,
          loading: isSaving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          {error && modalOpen && (
            <div style={{ marginBottom: "16px" }}>
              <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
            </div>
          )}
          <FormLayout>
            <FormLayout.Group>
              <TextField label="Plan Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} autoComplete="off" requiredIndicator disabled={isSaving} />
              <TextField label="Slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} autoComplete="off" helpText="Lowercase, no spaces" requiredIndicator disabled={isSaving} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Price (USD/mo)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} autoComplete="off" helpText="0 = free" disabled={isSaving} />
              <TextField label="Trial Days" type="number" value={form.trialDays} onChange={(v) => setForm({ ...form, trialDays: v })} autoComplete="off" helpText="0 = no trial" disabled={isSaving} />
            </FormLayout.Group>
            <TextField label="Max Offers" type="number" value={form.maxOffers} onChange={(v) => setForm({ ...form, maxOffers: v })} autoComplete="off" helpText="-1 = unlimited" disabled={isSaving} />
            <Select
              label="Status"
              options={[
                { label: "Active — visible to merchants", value: "active" },
                { label: "Hidden — not shown on pricing page", value: "hidden" },
              ]}
              value={form.isActive ? "active" : "hidden"}
              onChange={(v) => setForm({ ...form, isActive: v === "active" })}
              disabled={isSaving}
            />
          </FormLayout>
        </Modal.Section>
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">Feature Flags</Text>
            <InlineGrid columns={2} gap="200">
              <Checkbox label="A/B Testing" checked={form.abTesting} onChange={(v) => setForm({ ...form, abTesting: v })} disabled={isSaving} />
              <Checkbox label="Analytics" checked={form.analytics} onChange={(v) => setForm({ ...form, analytics: v })} disabled={isSaving} />
              <Checkbox label="Custom Branding" checked={form.customBranding} onChange={(v) => setForm({ ...form, customBranding: v })} disabled={isSaving} />
              <Checkbox label="Priority Support" checked={form.prioritySupport} onChange={(v) => setForm({ ...form, prioritySupport: v })} disabled={isSaving} />
              <Checkbox label="Scheduled Offers" checked={form.scheduledOffers} onChange={(v) => setForm({ ...form, scheduledOffers: v })} disabled={isSaving} />
              <Checkbox label="Funnel Chaining" checked={form.funnelChaining} onChange={(v) => setForm({ ...form, funnelChaining: v })} disabled={isSaving} />
              <Checkbox label="CSV Export" checked={form.csvExport} onChange={(v) => setForm({ ...form, csvExport: v })} disabled={isSaving} />
            </InlineGrid>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete plan?"
        primaryAction={{
          content: isDeleting ? "Deleting..." : "Delete plan",
          onAction: handleDelete,
          destructive: true,
          loading: isDeleting,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              {`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
            </Text>
            {(subCounts[deleteTarget?.slug] || 0) > 0 && (
              <Banner tone="warning">
                {`${subCounts[deleteTarget?.slug]} merchant(s) are currently on this plan.`}
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Toasts */}
      {success && <Toast content={success} onDismiss={() => setSuccess(null)} />}
      {error && !modalOpen && <Toast content={error} error onDismiss={() => setError(null)} />}
    </Page>
  );
}
