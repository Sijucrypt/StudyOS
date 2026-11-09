import { z } from "zod";

const field = (max: number) => z.string().trim().min(1, "Enter a value.").max(max);
const optionalDate = z.union([z.literal(""), z.iso.date()]).transform((value) => value || null);

export const periodSchema = z.object({
  name: field(100),
  starts_on: optionalDate,
  ends_on: optionalDate,
}).refine(({ starts_on, ends_on }) => !starts_on || !ends_on || starts_on <= ends_on, {
  message: "The end date must be on or after the start date.",
});

export const courseSchema = z.object({
  code: field(30).transform((value) => value.toUpperCase()).pipe(z.string().max(30)),
  title: field(160),
  units: z.string().regex(/^\d+$/, "Enter whole units of zero or more.").transform(Number)
    .pipe(z.number().int().min(0).max(2147483647)),
  description: z.string().trim().max(2000),
});

export const topicSchema = z.object({
  title: field(160),
  parent_topic_id: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
});

export const profileSchema = z.object({
  display_name: z.string().trim().max(100),
  timezone: z.string().trim().min(1).max(100).refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return !/^[+-]/.test(zone);
    } catch {
      return false;
    }
  }, "Enter a valid IANA timezone, such as Africa/Lagos."),
});
