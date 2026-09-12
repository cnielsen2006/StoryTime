import { z } from 'zod';

export const Id = z.string().min(1).max(64);

/** Trimmed free text; empty string normalises to null so the serializer can omit it. */
export const OptionalText = z
  .string()
  .trim()
  .max(20000)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const RequiredName = z.string().trim().min(1, 'Name is required').max(200);

export const SortOrder = z.number().int().min(0);

export const ReorderInput = z.object({
  ids: z.array(Id).min(1),
});
export type ReorderInput = z.infer<typeof ReorderInput>;

export const Timestamps = z.object({
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

/** Null and undefined mean different things on PATCH: null clears, undefined leaves alone. */
export function patchOf<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).partial();
}
