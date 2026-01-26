import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const email = "employee@test.local";
const password = "Test12345!";
const role = "EMPLOYEE";

async function run() {
  const hash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        password: hash,
        passwordHash: hash,
        role,
        isActive: true,
      },
    });
    console.log("EMPLOYEE updated:", email);
  } else {
    await prisma.user.create({
      data: {
        email,
        password: hash,
        passwordHash: hash,
        name: "Test Employee",
        role,
        isActive: true,
      },
    });
    console.log("EMPLOYEE created:", email);
  }
}

run()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
