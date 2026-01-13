import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureDefaultOrg() {
  const existing = await prisma.organization.findFirst();
  if (existing) return existing;
  return prisma.organization.create({
    data: { name: "Default Organization" },
  });
}

async function backfillOrgId(model, orgId) {
  if (!prisma[model]) return;
  await prisma[model].updateMany({
    where: { orgId: null },
    data: { orgId },
  });
}

async function ensureMemberships(orgId) {
  const users = await prisma.user.findMany();
  for (const user of users) {
    await prisma.membership.upsert({
      where: {
        orgId_userId: {
          orgId,
          userId: user.id,
        },
      },
      update: { role: user.role },
      create: {
        orgId,
        userId: user.id,
        role: user.role,
      },
    });
  }
}

async function ensureSubscription(orgId) {
  const existing = await prisma.subscription.findFirst({ where: { orgId } });
  if (!existing) {
    await prisma.subscription.create({
      data: {
        orgId,
        plan: "basic-30",
        status: "inactive",
        paidUntil: null,
      },
    });
  }
}

async function main() {
  const org = await ensureDefaultOrg();

  await Promise.all([
    backfillOrgId("employee", org.id),
    backfillOrgId("hrLeaveApplication", org.id),
    backfillOrgId("safetyInstruction", org.id),
    backfillOrgId("safetyAssignment", org.id),
    backfillOrgId("leaveRequest", org.id),
    backfillOrgId("paymentRequest", org.id),
    backfillOrgId("warehouseRequest", org.id),
    backfillOrgId("warehouseRequestItem", org.id),
    backfillOrgId("warehouseTask", org.id),
    backfillOrgId("purchaseOrder", org.id),
    backfillOrgId("purchaseOrderItem", org.id),
    backfillOrgId("item", org.id),
    backfillOrgId("warehouseLocation", org.id),
    backfillOrgId("warehousePlacement", org.id),
    backfillOrgId("stockMovement", org.id),
    backfillOrgId("binAuditSession", org.id),
    backfillOrgId("binAuditEvent", org.id),
    backfillOrgId("stockDiscrepancy", org.id),
    backfillOrgId("receivingDiscrepancy", org.id),
    backfillOrgId("orgProfile", org.id),
    backfillOrgId("supplier", org.id),
    backfillOrgId("supplierTruck", org.id),
    backfillOrgId("inviteToken", org.id),
    backfillOrgId("membership", org.id),
    backfillOrgId("subscription", org.id),
    backfillOrgId("payment", org.id),
  ]);

  await ensureMemberships(org.id);
  await ensureSubscription(org.id);
}

main()
  .then(() => {
    console.log("Backfill completed");
  })
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
