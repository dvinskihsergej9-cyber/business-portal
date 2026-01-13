const express = require("express");
const router = express.Router();

// Либо подключай общий prisma-клиент,
// если он у тебя вынесен в отдельный файл.
// Простой вариант — создать здесь:
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// GET /api/supplier-trucks?onlyActive=1
router.get("/supplier-trucks", async (req, res) => {
  try {
    const onlyActive = req.query.onlyActive === "1";

    const where = onlyActive
      ? {
          OR: [
            { status: "IN_QUEUE" },
            { status: "UNLOADING" },
          ],
        }
      : {};

    const rows = await prisma.supplierTruckQueue.findMany({
      where,
      orderBy: { arrivalAt: "asc" },
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ message: "Ошибка загрузки очереди машин" });
  }
});

// POST /api/supplier-trucks
router.post("/supplier-trucks", async (req, res) => {
  try {
    const {
      supplier,
      orderNumber,
      deliveryDate,
      vehicleBrand,
      truckNumber,
      driverName,
      driverPhone,
      cargo,
      note,
      directImport,
    } = req.body;

    const row = await prisma.supplierTruckQueue.create({
      data: {
        supplier,
        orderNumber,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        vehicleBrand,
        truckNumber,
        driverName,
        driverPhone,
        cargo,
        note,
        directImport: Boolean(directImport),
        status: "IN_QUEUE",
      },
    });

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ message: "Ошибка регистрации машины" });
  }
});

// PUT /api/supplier-trucks/:id/status
router.put("/supplier-trucks/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, gate } = req.body;

    const data = { status };
    const now = new Date();

    if (status === "UNLOADING") {
      data.gate = gate || null;
      data.unloadStartAt = now;
    } else if (status === "DONE") {
      data.unloadEndAt = now;
    }

    const updated = await prisma.supplierTruckQueue.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Ошибка смены статуса" });
  }
});

module.exports = router;
