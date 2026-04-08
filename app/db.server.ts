import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const isProduction = process.env.NODE_ENV === "production";

// In production, use DATABASE_URL_PRODUCTION if set, otherwise fall back to DATABASE_URL
// Prisma reads DATABASE_URL by default, so we override it here for production
if (isProduction && process.env.DATABASE_URL_PRODUCTION) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PRODUCTION;
}

if (!isProduction) {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
