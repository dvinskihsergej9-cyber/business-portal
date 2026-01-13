import express from "express";

function getLeaveDaysByCategory(category) {
  switch (category) {
    case "FAR_NORTH":
      return 28 + 24;
    case "EQUIVALENT_NORTH":
      return 28 + 16;
    case "OTHER_NORTH_COEF":
      return 28 + 8;
    case "STANDARD":
    default:
      return 28;
  }
}

export function adminRoutes({ prisma, auth, requireAdmin }) {
  const router = express.Router();

  router.use(auth, requireAdmin);
  const REQUEST_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "REJECTED"];

  router.get("/hr/employees", async (req, res) => {
    try {
      const employees = await prisma.employee.findMany({
        orderBy: { id: "asc" },
      });
      return res.json(employees);
    } catch (err) {
      console.error("admin employees list error:", err);
      return res.status(500).json({ message: "EMPLOYEES_LIST_ERROR" });
    }
  });

  router.put("/hr/employees/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_EMPLOYEE_ID" });
      }

      const existing = await prisma.employee.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "EMPLOYEE_NOT_FOUND" });
      }

      const {
        fullName,
        position,
        department,
        hiredAt,
        status,
        telegramChatId,
        birthDate,
        leaveRegionCategory,
        annualLeaveDays,
        leaveOverrideDays,
      } = req.body || {};

      if (!fullName || !String(fullName).trim()) {
        return res.status(400).json({ message: "FULLNAME_REQUIRED" });
      }
      if (!position || !String(position).trim()) {
        return res.status(400).json({ message: "POSITION_REQUIRED" });
      }
      if (!department || !String(department).trim()) {
        return res.status(400).json({ message: "DEPARTMENT_REQUIRED" });
      }

      let parsedHiredAt = null;
      if (hiredAt) {
        const d = new Date(hiredAt);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "INVALID_HIRED_AT" });
        }
        parsedHiredAt = d;
      }

      let parsedBirthDate = null;
      if (birthDate) {
        const d = new Date(birthDate);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "INVALID_BIRTH_DATE" });
        }
        parsedBirthDate = d;
      }

      const category = leaveRegionCategory || "STANDARD";
      const computedDays = getLeaveDaysByCategory(category);
      let finalDays = computedDays;

      if (leaveOverrideDays !== undefined && leaveOverrideDays !== null) {
        const override = Number(leaveOverrideDays);
        if (!Number.isFinite(override) || override <= 0) {
          return res.status(400).json({ message: "INVALID_LEAVE_OVERRIDE" });
        }
        finalDays = override;
      } else if (category === "CUSTOM") {
        const custom = Number(annualLeaveDays);
        if (!Number.isFinite(custom) || custom <= 0) {
          return res.status(400).json({ message: "INVALID_ANNUAL_LEAVE" });
        }
        finalDays = custom;
      }

      const updated = await prisma.employee.update({
        where: { id },
        data: {
          fullName: String(fullName).trim(),
          position: String(position).trim(),
          department: String(department).trim(),
          status: status ? String(status).trim() : existing.status,
          telegramChatId:
            telegramChatId !== undefined ? telegramChatId : existing.telegramChatId,
          hiredAt: parsedHiredAt || existing.hiredAt,
          birthDate: parsedBirthDate,
          leaveRegionCategory: category,
          annualLeaveDays: finalDays,
          leaveOverrideDays:
            leaveOverrideDays !== undefined ? leaveOverrideDays : null,
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error("admin employee update error:", err);
      return res.status(500).json({ message: "EMPLOYEE_UPDATE_ERROR" });
    }
  });

  router.delete("/hr/employees/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_EMPLOYEE_ID" });
      }

      const existing = await prisma.employee.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "EMPLOYEE_NOT_FOUND" });
      }

      await prisma.employee.delete({ where: { id } });
      return res.json({ message: "EMPLOYEE_DELETED" });
    } catch (err) {
      console.error("admin employee delete error:", err);
      return res.status(500).json({ message: "EMPLOYEE_DELETE_ERROR" });
    }
  });

  router.get("/warehouse/items", async (req, res) => {
    try {
      const items = await prisma.item.findMany({
        orderBy: { id: "asc" },
      });
      return res.json(items);
    } catch (err) {
      console.error("admin items list error:", err);
      return res.status(500).json({ message: "ITEMS_LIST_ERROR" });
    }
  });

  router.put("/warehouse/items/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_ITEM_ID" });
      }
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "ITEM_NOT_FOUND" });
      }
      const {
        name,
        sku,
        barcode,
        unit,
        minStock,
        maxStock,
        defaultPrice,
      } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ message: "NAME_REQUIRED" });
      }
      const updated = await prisma.item.update({
        where: { id },
        data: {
          name: String(name).trim(),
          sku: sku ? String(sku).trim() : null,
          barcode: barcode ? String(barcode).trim() : null,
          unit: unit ? String(unit).trim() : null,
          minStock: minStock === "" || minStock === null ? null : Number(minStock),
          maxStock: maxStock === "" || maxStock === null ? null : Number(maxStock),
          defaultPrice:
            defaultPrice === "" || defaultPrice === null
              ? null
              : Number(defaultPrice),
        },
      });
      return res.json(updated);
    } catch (err) {
      console.error("admin item update error:", err);
      if (err.code === "P2002") {
        return res.status(400).json({ message: "ITEM_UNIQUE_CONFLICT" });
      }
      return res.status(500).json({ message: "ITEM_UPDATE_ERROR" });
    }
  });

  router.delete("/warehouse/items/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_ITEM_ID" });
      }
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "ITEM_NOT_FOUND" });
      }
      const [placements, movements, orderItems] = await Promise.all([
        prisma.warehousePlacement.count({ where: { itemId: id } }),
        prisma.stockMovement.count({ where: { itemId: id } }),
        prisma.purchaseOrderItem.count({ where: { itemId: id } }),
      ]);
      if (placements || movements || orderItems) {
        return res.status(400).json({ message: "ITEM_HAS_RELATIONS" });
      }
      await prisma.item.delete({ where: { id } });
      return res.json({ message: "ITEM_DELETED" });
    } catch (err) {
      console.error("admin item delete error:", err);
      return res.status(500).json({ message: "ITEM_DELETE_ERROR" });
    }
  });

  router.get("/warehouse/locations", async (req, res) => {
    try {
      const locations = await prisma.warehouseLocation.findMany({
        orderBy: { id: "asc" },
      });
      return res.json(locations);
    } catch (err) {
      console.error("admin locations list error:", err);
      return res.status(500).json({ message: "LOCATIONS_LIST_ERROR" });
    }
  });

  router.put("/warehouse/locations/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_LOCATION_ID" });
      }
      const existing = await prisma.warehouseLocation.findUnique({
        where: { id },
      });
      if (!existing) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
      const { name, code, zone, aisle, rack, level } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ message: "NAME_REQUIRED" });
      }
      const updated = await prisma.warehouseLocation.update({
        where: { id },
        data: {
          name: String(name).trim(),
          code: code ? String(code).trim() : null,
          zone: zone ? String(zone).trim() : null,
          aisle: aisle ? String(aisle).trim() : null,
          rack: rack ? String(rack).trim() : null,
          level: level ? String(level).trim() : null,
        },
      });
      return res.json(updated);
    } catch (err) {
      console.error("admin location update error:", err);
      if (err.code === "P2002") {
        return res.status(400).json({ message: "LOCATION_UNIQUE_CONFLICT" });
      }
      return res.status(500).json({ message: "LOCATION_UPDATE_ERROR" });
    }
  });

  router.delete("/warehouse/locations/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_LOCATION_ID" });
      }
      const existing = await prisma.warehouseLocation.findUnique({
        where: { id },
      });
      if (!existing) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
      const placements = await prisma.warehousePlacement.count({
        where: { locationId: id },
      });
      if (placements) {
        return res.status(400).json({ message: "LOCATION_HAS_STOCK" });
      }
      await prisma.warehouseLocation.delete({ where: { id } });
      return res.json({ message: "LOCATION_DELETED" });
    } catch (err) {
      console.error("admin location delete error:", err);
      return res.status(500).json({ message: "LOCATION_DELETE_ERROR" });
    }
  });

  router.get("/warehouse/requests", async (req, res) => {
    try {
      const requests = await prisma.warehouseRequest.findMany({
        orderBy: { id: "desc" },
        include: {
          items: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      return res.json(requests);
    } catch (err) {
      console.error("admin requests list error:", err);
      return res.status(500).json({ message: "REQUESTS_LIST_ERROR" });
    }
  });

  router.put("/warehouse/requests/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_REQUEST_ID" });
      }
      const existing = await prisma.warehouseRequest.findUnique({
        where: { id },
      });
      if (!existing) {
        return res.status(404).json({ message: "REQUEST_NOT_FOUND" });
      }

      const { status, statusComment, comment, desiredDate } = req.body || {};
      if (status && !REQUEST_STATUSES.includes(status)) {
        return res.status(400).json({ message: "INVALID_STATUS" });
      }
      let parsedDesiredDate = null;
      if (desiredDate) {
        const d = new Date(desiredDate);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "INVALID_DATE" });
        }
        parsedDesiredDate = d;
      }

      const updated = await prisma.warehouseRequest.update({
        where: { id },
        data: {
          status: status || existing.status,
          statusComment:
            statusComment !== undefined ? statusComment : existing.statusComment,
          comment: comment !== undefined ? comment : existing.comment,
          desiredDate:
            parsedDesiredDate !== null ? parsedDesiredDate : existing.desiredDate,
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error("admin request update error:", err);
      return res.status(500).json({ message: "REQUEST_UPDATE_ERROR" });
    }
  });

  return router;
}
