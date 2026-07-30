import { PrismaClient } from "@prisma/client";

let prisma;

/**
 * Returns a shared Prisma client instance.
 * @returns {PrismaClient}
 */
export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export const database = getPrisma();
