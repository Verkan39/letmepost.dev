import { z } from "zod";

export const ApiKeyPrefix = z.enum(["lmp_live_", "lmp_test_"]);
export type ApiKeyPrefix = z.infer<typeof ApiKeyPrefix>;
