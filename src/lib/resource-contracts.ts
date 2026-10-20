import { z } from "zod";

export const resourceMetadataSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  type: z.enum(["image", "svg", "pdf", "dxf", "text"]),
  size: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024),
  width: z.number().positive().finite().optional(),
  height: z.number().positive().finite().optional(),
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  units: z.string().max(20).optional(),
});
export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;
export const resourcePreviewSchema = z.object({
  resourceId: z.string().min(1).max(200),
  name: z.string().max(500),
  page: z.number().int().positive().optional(),
  image: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});
const resource = { resource_id: z.string().min(1).max(200) };
export const listResourcesSchema = z
  .object({
    offset: z
      .number()
      .int()
      .min(0)
      .nullish()
      .transform((n) => n ?? 0),
  })
  .strict();
export const inspectResourceSchema = z
  .object({
    ...resource,
    page: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .nullish()
      .transform((n) => n ?? 1),
    preview: z
      .boolean()
      .nullish()
      .transform((n) => n ?? false),
  })
  .strict();
export const readResourceSchema = z
  .object({
    ...resource,
    page: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .nullish()
      .transform((n) => n ?? 1),
    offset: z
      .number()
      .int()
      .min(0)
      .nullish()
      .transform((n) => n ?? 0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12000)
      .nullish()
      .transform((n) => n ?? 6000),
    query: z.string().min(1).max(500).nullish(),
  })
  .strict();
const coordinate = z.number().finite().min(-100000).max(100000);
export const placeSvgSchema = z
  .object({
    ...resource,
    object_id: z
      .string()
      .regex(/^[a-zA-Z][\w.-]*$/)
      .max(100),
    revision: z.string().max(200).nullish(),
    x: coordinate,
    y: coordinate,
    width: z.number().positive().max(100000),
    bounds: z.enum(["content", "canvas"]),
    anchor: z.enum(["origin", "center"]).nullish(),
    target_id: z.string().min(1).max(200).nullish(),
    fit_box: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
      })
      .nullish(),
    rotation: z.number().finite().min(-360).max(360).nullish(),
    canvas: z
      .object({
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
      })
      .nullish(),
  })
  .strict();
export const transformObjectSchema = z
  .object({
    object_id: z.string().min(1).max(200),
    revision: z.string().min(1).max(200),
    x: coordinate,
    y: coordinate,
    scale: z.number().positive().max(10000),
    rotation: z.number().finite().min(-360).max(360),
  })
  .strict();
