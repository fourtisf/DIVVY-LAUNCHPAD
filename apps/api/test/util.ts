import { z } from "zod";

/** Applies .strict() recursively so an extra field fails as well as a missing one. */
export function strict<T extends z.ZodTypeAny>(schema: T): z.ZodTypeAny {
  const s = schema as z.ZodTypeAny;
  if (s instanceof z.ZodObject) {
    const shape = Object.fromEntries(Object.entries(s.shape).map(([k, v]) => [k, strict(v as z.ZodTypeAny)]));
    return z.object(shape).strict();
  }
  if (s instanceof z.ZodArray) return z.array(strict(s.element as z.ZodTypeAny));
  if (s instanceof z.ZodNullable) return strict(s.unwrap() as z.ZodTypeAny).nullable();
  if (s instanceof z.ZodOptional) return strict(s.unwrap() as z.ZodTypeAny).optional();
  if (s instanceof z.ZodDiscriminatedUnion) return z.union(s.options.map((o) => strict(o as z.ZodTypeAny)) as unknown as [z.ZodTypeAny, z.ZodTypeAny]);
  return s;
}

export const expectShape = (schema: z.ZodTypeAny, body: unknown) => {
  const r = strict(schema).safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5), null, 2));
  return r.data;
};
