-- Add item category (STOCK/TMC)
ALTER TABLE "Item" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'STOCK';
