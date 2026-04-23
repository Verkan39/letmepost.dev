import { z } from "zod";

export const OrganizationMemberRole = z.enum(["owner", "admin", "member"]);
export type OrganizationMemberRole = z.infer<typeof OrganizationMemberRole>;
