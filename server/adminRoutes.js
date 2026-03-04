import express from "express";
import bcrypt from "bcryptjs";
import { hasPermission, PERMISSION_KEYS } from "./permissions.js";

export function adminRoutes({ prisma, auth, requireAdmin }) {
  const router = express.Router();

  router.use(auth, requireAdmin);
  const MAX_ITEM_IMAGE_BYTES = 3 * 1024 * 1024;

  const normalizeItemImageDataUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      const err = new Error("ITEM_IMAGE_BAD_FORMAT");
      err.code = "ITEM_IMAGE_BAD_FORMAT";
      throw err;
    }
    const mime = String(match[1] || "").toLowerCase().replace("image/jpg", "image/jpeg");
    const base64 = String(match[2] || "");
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) {
      const err = new Error("ITEM_IMAGE_EMPTY");
      err.code = "ITEM_IMAGE_EMPTY";
      throw err;
    }
    if (bytes.length > MAX_ITEM_IMAGE_BYTES) {
      const err = new Error("ITEM_IMAGE_TOO_LARGE");
      err.code = "ITEM_IMAGE_TOO_LARGE";
      throw err;
    }
    return `data:${mime};base64,${bytes.toString("base64")}`;
  };

  const requirePermission = (permissionKey) => (req, res, next) => {
    if (hasPermission(req.user, permissionKey)) return next();
    return res.status(403).json({ message: "Нет доступа к разделу." });
  };

  const requireUsersAdmin = requirePermission(PERMISSION_KEYS.ADMIN_USERS);
  const requireWarehouseAdmin = requirePermission(PERMISSION_KEYS.ADMIN_WAREHOUSE);
  const REQUEST_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "REJECTED"];

  router.post("/create-employee", requireUsersAdmin, async (req, res) => {
    try {
      const email = String(req.body?.email || "employee@test.local").trim();
      const password = String(req.body?.password || "Test12345!").trim();
      if (!email || !password) {
        return res.status(400).json({ message: "EMAIL_PASSWORD_REQUIRED" });
      }

      const hash = await bcrypt.hash(password, 10);
      const existing = await prisma.user.findUnique({ where: { email } });
      let user = null;
      if (existing) {
        user = await prisma.user.update({
          where: { email },
          data: {
            password: hash,
            passwordHash: hash,
            role: "EMPLOYEE",
            isActive: true,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            password: hash,
            passwordHash: hash,
            name: "Test Employee",
            role: "EMPLOYEE",
            isActive: true,
          },
        });
      }

      return res.json({
        id: user.id,
        email: user.email,
        role: user.role,
      });
    } catch (err) {
      console.error("admin create employee error:", err);
      return res.status(500).json({ message: "CREATE_EMPLOYEE_ERROR" });
    }
  });

  router.get("/warehouse/items", requireWarehouseAdmin, async (req, res) => {
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

  router.put("/warehouse/items/:id", requireWarehouseAdmin, async (req, res) => {
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
        autoReorderEnabled,
        autoReorderMin,
        autoReorderSupplierId,
        autoReorderContactName,
        autoReorderContactEmail,
        autoReorderMessage,
        autoReorderReset,
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
          autoReorderEnabled: Boolean(autoReorderEnabled),
          autoReorderMin:
            autoReorderMin === "" || autoReorderMin === null
              ? null
              : Number(autoReorderMin),
          autoReorderSupplierId:
            autoReorderSupplierId === "" || autoReorderSupplierId == null
              ? null
              : Number(autoReorderSupplierId),
          autoReorderContactName: autoReorderContactName
            ? String(autoReorderContactName).trim()
            : null,
          autoReorderContactEmail: autoReorderContactEmail
            ? String(autoReorderContactEmail).trim()
            : null,
          autoReorderMessage: autoReorderMessage
            ? String(autoReorderMessage).trim()
            : null,
          autoReorderActive:
            Boolean(autoReorderEnabled) && !autoReorderReset
              ? existing.autoReorderActive
              : false,
          autoReorderLastReminderAt: autoReorderReset
            ? null
            : existing.autoReorderLastReminderAt,
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

  router.put("/warehouse/items/:id/image", requireWarehouseAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_ITEM_ID" });
      }
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "ITEM_NOT_FOUND" });
      }

      const hasField = Object.prototype.hasOwnProperty.call(req.body || {}, "imageDataUrl");
      if (!hasField) {
        return res.status(400).json({ message: "ITEM_IMAGE_REQUIRED" });
      }

      const normalized =
        req.body?.imageDataUrl == null || String(req.body.imageDataUrl).trim() === ""
          ? null
          : normalizeItemImageDataUrl(req.body.imageDataUrl);

      const updated = await prisma.item.update({
        where: { id },
        data: { imageUrl: normalized },
        select: { id: true, imageUrl: true },
      });
      return res.json({ ok: true, item: updated });
    } catch (err) {
      if (err.code === "ITEM_IMAGE_BAD_FORMAT") {
        return res
          .status(400)
          .json({ message: "Поддерживаются только изображения JPG, PNG или WEBP." });
      }
      if (err.code === "ITEM_IMAGE_EMPTY") {
        return res.status(400).json({ message: "Файл изображения пустой." });
      }
      if (err.code === "ITEM_IMAGE_TOO_LARGE") {
        return res
          .status(413)
          .json({ message: "Изображение слишком большое. Максимум 3 МБ." });
      }
      console.error("admin item image update error:", err);
      return res.status(500).json({ message: "ITEM_IMAGE_UPDATE_ERROR" });
    }
  });

  router.delete("/warehouse/items/:id", requireWarehouseAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "INVALID_ITEM_ID" });
      }
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "ITEM_NOT_FOUND" });
      }
      await prisma.$transaction(async (tx) => {
        await tx.salesOrderLine.updateMany({
          where: { itemId: id },
          data: { itemId: null },
        });
        await tx.receivingDiscrepancy.updateMany({
          where: { itemId: id },
          data: { itemId: null },
        });
        await tx.stockRevisionItem.deleteMany({ where: { itemId: id } });
        await tx.stockDiscrepancy.deleteMany({ where: { itemId: id } });
        await tx.warehousePlacement.deleteMany({ where: { itemId: id } });
        await tx.warehouseReceivingLine.deleteMany({ where: { itemId: id } });
        await tx.stockMovement.deleteMany({ where: { itemId: id } });
        await tx.purchaseOrderItem.deleteMany({ where: { itemId: id } });
        await tx.item.delete({ where: { id } });
      });
      return res.json({ message: "ITEM_DELETED" });
    } catch (err) {
      console.error("admin item delete error:", err);
      return res.status(500).json({ message: "ITEM_DELETE_ERROR" });
    }
  });

  router.get("/warehouse/locations", requireWarehouseAdmin, async (req, res) => {
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

  router.put("/warehouse/locations/:id", requireWarehouseAdmin, async (req, res) => {
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

  router.delete("/warehouse/locations/:id", requireWarehouseAdmin, async (req, res) => {
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

  router.get("/warehouse/requests", requireWarehouseAdmin, async (req, res) => {
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

  router.put("/warehouse/requests/:id", requireWarehouseAdmin, async (req, res) => {
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
