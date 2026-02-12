import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
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
    const deletedItems = await tx.item.deleteMany({});

    return { deletedItems: deletedItems.count };
  });

  console.log("OK", result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
