import * as z from "zod";

export const ROLES = ["question_figure", "answer_option", "response_template"] as const;
export const COURSES = [
  "mathematics_advanced",
  "mathematics_extension_1",
  "mathematics_extension_2"
] as const;
export const CATEGORIES = [
  "cartesian_function_plot",
  "calculus_region_or_field",
  "statistical_chart",
  "plane_geometry",
  "mechanics_or_motion_schematic",
  "complex_plane",
  "spatial_geometry_or_solid",
  "vector_diagram",
  "probability_or_set_diagram",
  "number_line_or_scale"
] as const;

const text = z.string().trim().min(1, "expected a non-empty string");
const integer = z.number().int().min(1, "expected an integer >= 1");
const digest = text.regex(/^[0-9a-f]{64}$/, "expected a lowercase hex sha256");

export const BoxSchema = z
  .strictObject({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive()
  })
  .refine(({ x, w }) => x + w <= 1.000001, "box must lie within the page")
  .refine(({ y, h }) => y + h <= 1.000001, "box must lie within the page");

export const ChecklistSchema = z
  .array(text)
  .min(1, "expected a non-empty array")
  .refine((items) => new Set(items).size === items.length, "items must be unique");

export const SampleOutputSchema = z.strictObject({
  width: integer,
  height: integer,
  sha256: digest
});

export const SampleSchema = z
  .strictObject({
    question: text,
    option: text.optional(),
    role: z.enum(ROLES),
    index: integer,
    page: integer,
    box: BoxSchema,
    masks: z.array(BoxSchema).optional(),
    category: z.enum(CATEGORIES),
    checklist: ChecklistSchema.optional(),
    output: SampleOutputSchema.optional()
  })
  .refine(({ role, option }) => (role === "answer_option") === (option !== undefined), {
    message: "answer_option samples, and only those, carry an option"
  });

export const ExamSchema = z.strictObject({
  course: z.enum(COURSES),
  year: integer,
  url: text,
  sha256: digest,
  samples: z.array(SampleSchema)
});

export const ManifestSchema = z.array(ExamSchema);

export type Box = z.infer<typeof BoxSchema>;
export type Role = z.infer<typeof SampleSchema>["role"];
export type Course = z.infer<typeof ExamSchema>["course"];
export type Category = z.infer<typeof SampleSchema>["category"];
export type SampleOutput = z.infer<typeof SampleOutputSchema>;
export type Sample = z.infer<typeof SampleSchema>;
export type Exam = z.infer<typeof ExamSchema>;

export function examId(exam: Exam): string {
  return `${exam.year}-${exam.course}`;
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function sampleStem(exam: Exam, sample: Sample): string {
  const kind = sample.option === undefined ? "figure" : `option-${slug(sample.option)}`;
  return `${examId(exam)}--q-${slug(sample.question)}--${kind}-${sample.index}`;
}

class ManifestError extends Error {}

export function parseManifest(json: unknown): Exam[] {
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? issue.path.join(".") : "root";
    throw new ManifestError(`manifest: ${where}: ${issue.message}`);
  }

  const exams = parsed.data;
  const seen = new Map<string, string>();
  for (const [i, exam] of exams.entries()) {
    const id = examId(exam);
    if (seen.has(id)) {
      throw new ManifestError(`manifest: exams[${i}]: duplicate exam ${id}`);
    }
    seen.set(id, `exams[${i}]`);
    for (const [j, sample] of exam.samples.entries()) {
      const stem = sampleStem(exam, sample);
      const where = `exams[${i}].samples[${j}]`;
      if (seen.has(stem)) {
        throw new ManifestError(
          `manifest: ${where}: duplicate sample ${stem} (also ${seen.get(stem)}); set index to distinguish them`
        );
      }
      seen.set(stem, where);
    }
  }
  return exams;
}

export function serializeManifest(exams: readonly Exam[]): string {
  return `${JSON.stringify(exams, null, 2)}\n`;
}
