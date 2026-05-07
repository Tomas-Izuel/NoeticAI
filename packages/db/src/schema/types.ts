import { customType } from "drizzle-orm/pg-core";

// pgvector → number[] codec. The on-wire form pgvector returns is a string
// like "[1,2,3]"; we parse to/from a plain JS number[].
export const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    fromDriver(value) {
      if (typeof value === "string") {
        return JSON.parse(value) as number[];
      }
      return value as unknown as number[];
    },
    toDriver(value) {
      return `[${value.join(",")}]`;
    },
  })(name);
