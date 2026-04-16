import process from "node:process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function readOwnerEmail() {
  return normalizeEmail(
    process.env.OWNER_EMAIL || process.env.OWNER_BOOTSTRAP_EMAIL || ""
  );
}

function readOwnerPassword() {
  return String(
    process.env.OWNER_PASSWORD || process.env.OWNER_BOOTSTRAP_PASSWORD || ""
  ).trim();
}

async function getOrCreateOwnerOrg(tx) {
  const code = "platform-owner";
  const name = "Владелец платформы";
  const existing = await tx.organization.findUnique({ where: { code } });
  if (existing) return existing;
  return tx.organization.create({
    data: {
      code,
      name,
      isActive: true,
    },
  });
}

async function findUserByEmailInsensitive(tx, email) {
  if (!email) return null;

  let user = await tx.user.findUnique({ where: { email } });
  if (!user) {
    user = await tx.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });
  }
  return user;
}

async function run() {
  const ownerEmail = readOwnerEmail();
  const ownerPassword = readOwnerPassword();
  const ownerName = String(process.env.OWNER_NAME || "Владелец платформы").trim() || "Владелец платформы";

  if (!ownerEmail) {
    throw new Error("OWNER_EMAIL_REQUIRED");
  }

  let ensuredOwner = null;

  await prisma.$transaction(async (tx) => {
    const ownerOrg = await getOrCreateOwnerOrg(tx);
    const existingByEmail = await findUserByEmailInsensitive(tx, ownerEmail);

    if (existingByEmail?.id) {
      ensuredOwner = await tx.user.update({
        where: { id: existingByEmail.id },
        data: {
          email: ownerEmail,
          name: existingByEmail.name || ownerName,
          role: "ADMIN",
          isSystemOwner: true,
          isActive: true,
          orgId: ownerOrg.id,
          emailVerifiedAt: existingByEmail.emailVerifiedAt || new Date(),
          passwordVisible: null,
        },
        select: {
          id: true,
          email: true,
          role: true,
          isSystemOwner: true,
          orgId: true,
        },
      });
    } else {
      if (ownerPassword.length < 8) {
        throw new Error("OWNER_PASSWORD_REQUIRED");
      }
      const hash = await bcrypt.hash(ownerPassword, 10);
      ensuredOwner = await tx.user.create({
        data: {
          email: ownerEmail,
          password: hash,
          passwordHash: hash,
          passwordVisible: null,
          name: ownerName,
          role: "ADMIN",
          isSystemOwner: true,
          isActive: true,
          orgId: ownerOrg.id,
          emailVerifiedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          role: true,
          isSystemOwner: true,
          orgId: true,
        },
      });
    }

    await tx.user.updateMany({
      where: {
        isSystemOwner: true,
        id: { not: ensuredOwner.id },
      },
      data: {
        isSystemOwner: false,
      },
    });
  });

  console.log("OWNER_GRANTED", {
    id: ensuredOwner?.id,
    email: ensuredOwner?.email,
    role: ensuredOwner?.role,
    isSystemOwner: ensuredOwner?.isSystemOwner,
    orgId: ensuredOwner?.orgId,
  });
}

run()
  .catch((err) => {
    if (err?.message === "OWNER_EMAIL_REQUIRED") {
      console.error("Set OWNER_EMAIL (or OWNER_BOOTSTRAP_EMAIL). Example:");
      console.error("OWNER_EMAIL=you@example.com npm run owner:grant");
      process.exit(1);
      return;
    }
    if (err?.message === "OWNER_PASSWORD_REQUIRED") {
      console.error("Owner user does not exist. Set OWNER_PASSWORD (>=8) to create it.");
      console.error("Example: OWNER_EMAIL=you@example.com OWNER_PASSWORD='StrongPass123!' npm run owner:grant");
      process.exit(1);
      return;
    }
    console.error("owner:grant failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
