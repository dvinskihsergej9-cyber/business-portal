export function createWarehouseStockService(prisma) {
  const normalizeQty = (value) => {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty === 0) {
      const err = new Error("BAD_QTY");
      err.code = "BAD_QTY";
      throw err;
    }
    return qty;
  };

  const sumMovements = (movements) => {
    let qty = 0;
    for (const m of movements) {
      if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
        qty += Number(m.quantity);
      } else if (m.type === "ISSUE") {
        qty -= Number(m.quantity);
      }
    }
    return qty;
  };

  const getItemLocationQty = async (tx, itemId, locationId) => {
    const movements = await tx.stockMovement.findMany({
      where: { itemId, locationId },
    });
    return sumMovements(movements);
  };

  const createMovementInTx = async (tx, data) => {
    const {
      opId,
      type,
      itemId,
      qty,
      locationId,
      fromLocationId,
      toLocationId,
      comment,
      refType,
      refId,
      userId,
    } = data;

    if (!itemId || !type) {
      const err = new Error("BAD_REQUEST");
      err.code = "BAD_REQUEST";
      throw err;
    }

    const amount = normalizeQty(qty);

    if (opId) {
      const existing = await tx.stockMovement.findUnique({ where: { opId } });
      if (existing) return existing;
    }

    if (type === "ISSUE" && locationId) {
      const current = await getItemLocationQty(tx, itemId, locationId);
      if (current < amount) {
        const err = new Error("INSUFFICIENT_QTY");
        err.code = "INSUFFICIENT_QTY";
        throw err;
      }
    }

    if (type === "INCOME" && amount <= 0) {
      const err = new Error("BAD_QTY");
      err.code = "BAD_QTY";
      throw err;
    }

    if (type === "ISSUE" && amount <= 0) {
      const err = new Error("BAD_QTY");
      err.code = "BAD_QTY";
      throw err;
    }

    return tx.stockMovement.create({
      data: {
        opId: opId || null,
        type,
        itemId,
        quantity: type === "ADJUSTMENT" ? amount : Math.abs(amount),
        locationId: locationId ?? null,
        fromLocationId: fromLocationId ?? null,
        toLocationId: toLocationId ?? null,
        comment: comment || null,
        refType: refType || null,
        refId: refId || null,
        createdById: userId || null,
      },
    });
  };

  const createMovement = async (data) => {
    return prisma.$transaction((tx) => createMovementInTx(tx, data));
  };

  const getLocationStock = async (locationId) => {
    const movements = await prisma.stockMovement.findMany({
      where: { locationId },
      include: { item: true },
    });

    const byItem = new Map();
    for (const movement of movements) {
      const id = movement.itemId;
      const entry = byItem.get(id) || {
        item: movement.item,
        qty: 0,
      };
      if (movement.type === "INCOME" || movement.type === "ADJUSTMENT") {
        entry.qty += Number(movement.quantity);
      } else if (movement.type === "ISSUE") {
        entry.qty -= Number(movement.quantity);
      }
      byItem.set(id, entry);
    }

    return Array.from(byItem.values()).map((row) => ({
      item: {
        id: row.item.id,
        name: row.item.name,
        sku: row.item.sku,
        barcode: row.item.barcode,
        unit: row.item.unit,
      },
      qty: Math.round(row.qty),
    }));
  };

  return {
    createMovement,
    createMovementInTx,
    getItemLocationQty,
    getLocationStock,
  };
}
