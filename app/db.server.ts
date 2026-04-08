import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const isDev = process.env.NODE_ENV !== "production";

// In dev, override DATABASE_URL with dev database
if (isDev && process.env.DATABASE_URL_DEV) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_DEV;
}

if (isDev) {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
