import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const item = await prisma.$transaction(async (tx) => {
    await tx.salesOrderLine.updateMany({
      where: { itemId: { not: null } },
      data: { itemId: null },
    });
    await tx.receivingDiscrepancy.updateMany({
      where: { itemId: { not: null } },
      data: { itemId: null },
    });
    await tx.stockRevisionItem.deleteMany({});
    await tx.stockDiscrepancy.deleteMany({});
    await tx.warehousePlacement.deleteMany({});
    await tx.warehouseReceivingLine.deleteMany({});
    await tx.stockMovement.deleteMany({});
    await tx.purchaseOrderItem.deleteMany({});
    await tx.item.deleteMany({});

    return await tx.item.create({
      data: {
        name: "Стартер 24V",
        sku: "ST-001",
        barcode: "ST-001",
        unit: "шт",
        minStock: 1,
        maxStock: 10,
        defaultPrice: 7500,
      },
    });
  });

  console.log("OK", { id: item.id, name: item.name, sku: item.sku });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
