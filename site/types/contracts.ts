import { z } from "zod";

export const nullableDateSchema = z
  .union([z.string(), z.date()])
  .nullable()
  .optional()
  .transform((value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  });

export const userSchema = z.object({
  id: z.number(),
  email: z.string().min(3),
  username: z.string().nullable().optional(),
  login: z.string(),
  name: z.string(),
  role: z.string(),
  orgId: z.number().nullable().optional(),
  organization: z
    .object({
      id: z.number(),
      name: z.string(),
      code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  createdAt: nullableDateSchema,
  isSystemOwner: z.boolean().optional().default(false),
  permissions: z.array(z.string()).optional().default([]),
  permissionTemplate: z.string().optional().default("ROLE_DEFAULT"),
  permissionOverrides: z
    .object({
      grants: z.array(z.string()).optional().default([]),
      revokes: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({ grants: [], revokes: [] }),
  roles: z.array(z.string()).optional().default([]),
  subscription: z
    .object({
      plan: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      paidUntil: nullableDateSchema,
      trialStartedAt: nullableDateSchema,
      trialUsed: z.boolean().optional(),
      isActive: z.boolean().optional().default(false),
    })
    .optional(),
});

export const authResultSchema = z.object({
  token: z.string(),
  user: userSchema,
  message: z.string().optional(),
});

export const notificationSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  linkUrl: z.string().nullable().optional(),
  isRead: z.boolean(),
  createdAt: nullableDateSchema,
  readAt: nullableDateSchema,
  payloadJson: z.unknown().optional(),
});

export const notificationsPayloadSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().default(0),
});

export const taskPhotoSchema = z.object({
  name: z.string(),
  contentType: z.string().optional(),
  size: z.number().optional(),
  dataUrl: z.string(),
});

export const taskSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  dueDate: nullableDateSchema,
  createdAt: nullableDateSchema,
  updatedAt: nullableDateSchema,
  executorUserId: z.number().nullable().optional(),
  executorName: z.string().nullable().optional(),
  assignerId: z.number(),
  taskPhotos: z.array(taskPhotoSchema).optional().default([]),
  responseText: z.string().nullable().optional(),
  responsePhotos: z.array(taskPhotoSchema).optional().default([]),
  responseUpdatedAt: nullableDateSchema,
  assigner: z
    .object({
      id: z.number(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .optional(),
});

export const stockSummaryItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  currentStock: z.number(),
  heldStock: z.number().optional().default(0),
  availableStock: z.number().optional().default(0),
});

export const orderLineSchema = z.object({
  id: z.number(),
  qty: z.number(),
  pickedQty: z.number().optional().default(0),
  item: z
    .object({
      id: z.number().optional(),
      name: z.string().nullable().optional(),
      sku: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const orderSchema = z.object({
  id: z.number(),
  status: z.string(),
  orderNumber: z.string(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  shippingAddress: z.string(),
  deliveryComment: z.string().nullable().optional(),
  createdAt: nullableDateSchema,
  updatedAt: nullableDateSchema,
  assignedToUserId: z.number().nullable().optional(),
  assignedToUser: z
    .object({ id: z.number(), name: z.string().nullable().optional(), email: z.string().nullable().optional() })
    .nullable()
    .optional(),
  lines: z.array(orderLineSchema).optional().default([]),
});

export const orderQueuePayloadSchema = z.object({
  items: z.array(orderSchema),
});

export const orderStatusEventSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  fromStatus: z.string().nullable().optional(),
  toStatus: z.string(),
  eventType: z.string(),
  createdAt: nullableDateSchema,
  actorUser: z
    .object({
      id: z.number(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  order: z
    .object({
      id: z.number(),
      orderNumber: z.string(),
      customerName: z.string(),
      status: z.string(),
    })
    .optional(),
});

export const orderHistoryPayloadSchema = z.object({
  items: z.array(orderStatusEventSchema),
  page: z.number().optional(),
  limit: z.number().optional(),
  total: z.number().optional(),
});

export const purchaseOrderItemSchema = z.object({
  id: z.number(),
  itemId: z.number(),
  quantity: z.number(),
  receivedQty: z.number().optional().default(0),
  price: z.number(),
  item: z
    .object({
      id: z.number(),
      name: z.string().nullable().optional(),
      sku: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const purchaseOrderSchema = z.object({
  id: z.number(),
  number: z.string().nullable().optional(),
  status: z.string(),
  receivingStage: z.string().nullable().optional(),
  date: nullableDateSchema,
  plannedDate: nullableDateSchema,
  createdAt: nullableDateSchema,
  updatedAt: nullableDateSchema,
  comment: z.string().nullable().optional(),
  supplier: z
    .object({ id: z.number(), name: z.string() })
    .nullable()
    .optional(),
  items: z.array(purchaseOrderItemSchema).optional().default([]),
});

export const warehouseTransactionSchema = z.object({
  id: z.string(),
  type: z.string(),
  result: z.string().optional().nullable(),
  createdAt: nullableDateSchema,
  title: z.string().optional().nullable(),
  subtitle: z.string().optional().nullable(),
  item: z
    .object({
      id: z.number().optional(),
      name: z.string().nullable().optional(),
      sku: z.string().nullable().optional(),
      barcode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  location: z
    .object({
      id: z.number().optional(),
      name: z.string().nullable().optional(),
      code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  qty: z.number().optional().nullable(),
  user: z
    .object({ id: z.number().optional(), name: z.string().nullable().optional() })
    .nullable()
    .optional(),
  comment: z.string().optional().nullable(),
  payload: z.unknown().optional(),
});

export const warehouseTransactionsPayloadSchema = z.object({
  items: z.array(warehouseTransactionSchema),
});

export const pickingReportSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  totals: z.object({
    workers: z.number(),
    orders: z.number(),
    lines: z.number(),
    qtyOrdered: z.number(),
    qtyPicked: z.number(),
  }),
  users: z.array(
    z.object({
      userId: z.number(),
      userName: z.string(),
      userLogin: z.string().nullable().optional(),
      ordersCount: z.number(),
      linesCount: z.number(),
      qtyOrdered: z.number(),
      qtyPicked: z.number(),
      firstEventAt: z.string().nullable().optional(),
      lastEventAt: z.string().nullable().optional(),
      orders: z.array(
        z.object({
          id: z.number(),
          orderNumber: z.string(),
          status: z.string(),
          customerName: z.string(),
          linesCount: z.number(),
          qtyOrdered: z.number(),
          qtyPicked: z.number(),
          pickedAt: z.string().nullable().optional(),
          completedAt: z.string().nullable().optional(),
          eventAt: z.string().nullable().optional(),
        })
      ),
    })
  ),
});

export const orgProfileSchema = z.object({
  profile: z
    .object({
      id: z.number(),
      orgName: z.string(),
      legalAddress: z.string(),
      actualAddress: z.string(),
      inn: z.string(),
      kpp: z.string(),
      phone: z.string(),
      purchaseOrderEmailTemplate: z.string().nullable().optional(),
      updatedAt: nullableDateSchema,
    })
    .nullable(),
});

export const marketingPreferencesSchema = z.object({
  enabled: z.boolean(),
  consentAt: nullableDateSchema,
  unsubscribedAt: nullableDateSchema,
  message: z.string().optional(),
});

export const usersPayloadSchema = z.array(
  z.object({
    id: z.number(),
    email: z.string(),
    username: z.string().nullable().optional(),
    login: z.string(),
    name: z.string(),
    role: z.string(),
    orgId: z.number().nullable().optional(),
    isSystemOwner: z.boolean().optional().default(false),
    permissions: z.array(z.string()).optional().default([]),
    organization: z
      .object({ id: z.number(), name: z.string(), code: z.string().nullable().optional() })
      .nullable()
      .optional(),
    createdAt: nullableDateSchema,
  })
);

export type User = z.infer<typeof userSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Order = z.infer<typeof orderSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
