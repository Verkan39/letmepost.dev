import { z } from "zod";
import { AccountRef } from "./platforms.js";

export const BLUESKY_MAX_GRAPHEMES = 300;

export const CreatePostRequest = z.object({
  account: AccountRef,
  text: z.string().min(1),
});
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

export const CreatePostResponse = z.object({
  id: z.string(),
  platform: z.string(),
  uri: z.string().optional(),
  cid: z.string().optional(),
  createdAt: z.string(),
});
export type CreatePostResponse = z.infer<typeof CreatePostResponse>;
