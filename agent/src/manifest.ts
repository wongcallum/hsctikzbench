export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const ROLES = ["question_figure", "answer_option", "response_template"] as const;
export type Role = (typeof ROLES)[number];

export const COURSES = [
  "mathematics_advanced",
  "mathematics_extension_1",
  "mathematics_extension_2"
] as const;
export type Course = (typeof COURSES)[number];

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
export type Category = (typeof CATEGORIES)[number];

export interface SampleOutput {
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface Sample {
  readonly question: string;
  readonly option?: string;
  readonly role: Role;
  // distinguish standalone figures within the same question and option
  readonly index: number;
  readonly page: number;
  readonly box: Box;
  readonly masks?: readonly Box[];
  readonly category: Category;
  output?: SampleOutput;
}

export interface Exam {
  readonly course: Course;
  readonly year: number;
  readonly url: string;
  readonly sha256: string;
  readonly samples: Sample[];
}

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

function box(value: unknown, where: string): Box {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["x", "y", "w", "h"].includes(key)) {
      throw new ManifestError(`manifest: ${where}.${key}: unexpected field`);
    }
  }
  const num = (key: string) => {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ManifestError(`manifest: ${where}.${key}: expected a number`);
    }
    return v;
  };
  const b = { x: num("x"), y: num("y"), w: num("w"), h: num("h") };
  if (b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0) {
    throw new ManifestError(`manifest: ${where}: box must have positive size`);
  }
  if (b.x + b.w > 1.000001 || b.y + b.h > 1.000001) {
    throw new ManifestError(`manifest: ${where}: box must lie within the page`);
  }
  return b;
}

function sample(value: unknown, where: string): Sample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (
      ![
        "question",
        "option",
        "role",
        "index",
        "page",
        "box",
        "masks",
        "category",
        "output"
      ].includes(key)
    ) {
      throw new ManifestError(`manifest: ${where}.${key}: unexpected field`);
    }
  }

  if (typeof r.role !== "string" || r.role.trim().length === 0) {
    throw new ManifestError(`manifest: ${where}.role: expected a non-empty string`);
  }
  if (!(ROLES as readonly string[]).includes(r.role)) {
    throw new ManifestError(`manifest: ${where}.role: expected one of ${ROLES.join(", ")}`);
  }
  const role = r.role as Role;

  let option: string | undefined;
  if (r.option !== undefined) {
    if (typeof r.option !== "string" || r.option.trim().length === 0) {
      throw new ManifestError(`manifest: ${where}.option: expected a non-empty string`);
    }
    option = r.option;
  }
  if ((role === "answer_option") !== (option !== undefined)) {
    throw new ManifestError(
      `manifest: ${where}: answer_option samples, and only those, carry an option`
    );
  }

  let masks: readonly unknown[] | undefined;
  if (r.masks !== undefined) {
    if (!Array.isArray(r.masks)) {
      throw new ManifestError(`manifest: ${where}.masks: expected an array`);
    }
    masks = r.masks;
  }

  if (typeof r.question !== "string" || r.question.trim().length === 0) {
    throw new ManifestError(`manifest: ${where}.question: expected a non-empty string`);
  }
  if (!Number.isInteger(r.index) || (r.index as number) < 1) {
    throw new ManifestError(`manifest: ${where}.index: expected an integer >= 1`);
  }
  if (!Number.isInteger(r.page) || (r.page as number) < 1) {
    throw new ManifestError(`manifest: ${where}.page: expected an integer >= 1`);
  }
  if (typeof r.category !== "string" || r.category.trim().length === 0) {
    throw new ManifestError(`manifest: ${where}.category: expected a non-empty string`);
  }
  if (!(CATEGORIES as readonly string[]).includes(r.category)) {
    throw new ManifestError(
      `manifest: ${where}.category: expected one of ${CATEGORIES.join(", ")}`
    );
  }

  return {
    question: r.question,
    option,
    role,
    index: r.index as number,
    page: r.page as number,
    box: box(r.box, `${where}.box`),
    masks: masks?.map((m, i) => box(m, `${where}.masks[${i}]`)),
    category: r.category as Category,
    output: r.output === undefined ? undefined : output(r.output, `${where}.output`)
  };
}

function output(value: unknown, where: string): SampleOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["width", "height", "sha256"].includes(key)) {
      throw new ManifestError(`manifest: ${where}.${key}: unexpected field`);
    }
  }
  if (!Number.isInteger(r.width) || (r.width as number) < 1) {
    throw new ManifestError(`manifest: ${where}.width: expected an integer >= 1`);
  }
  if (!Number.isInteger(r.height) || (r.height as number) < 1) {
    throw new ManifestError(`manifest: ${where}.height: expected an integer >= 1`);
  }
  return {
    width: r.width as number,
    height: r.height as number,
    sha256: digest(r.sha256, `${where}.sha256`)
  };
}

function digest(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestError(`manifest: ${where}: expected a non-empty string`);
  }
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new ManifestError(`manifest: ${where}: expected a lowercase hex sha256`);
  }
  return value;
}

export function parseManifest(json: unknown): Exam[] {
  if (!Array.isArray(json)) {
    throw new ManifestError("manifest: root: expected an array of exams");
  }
  const exams = json.map((value, i): Exam => {
    const where = `exams[${i}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ManifestError(`manifest: ${where}: expected an object`);
    }
    const r = value as Record<string, unknown>;
    for (const key of Object.keys(r)) {
      if (!["course", "year", "url", "sha256", "samples"].includes(key)) {
        throw new ManifestError(`manifest: ${where}.${key}: unexpected field`);
      }
    }
    if (!Array.isArray(r.samples)) {
      throw new ManifestError(`manifest: ${where}.samples: expected an array`);
    }
    const samples: readonly unknown[] = r.samples;

    if (typeof r.course !== "string" || r.course.trim().length === 0) {
      throw new ManifestError(`manifest: ${where}.course: expected a non-empty string`);
    }
    if (!(COURSES as readonly string[]).includes(r.course)) {
      throw new ManifestError(`manifest: ${where}.course: expected one of ${COURSES.join(", ")}`);
    }
    if (!Number.isInteger(r.year) || (r.year as number) < 1) {
      throw new ManifestError(`manifest: ${where}.year: expected an integer >= 1`);
    }
    if (typeof r.url !== "string" || r.url.trim().length === 0) {
      throw new ManifestError(`manifest: ${where}.url: expected a non-empty string`);
    }
    return {
      course: r.course as Course,
      year: r.year as number,
      url: r.url,
      sha256: digest(r.sha256, `${where}.sha256`),
      samples: samples.map((s, j) => sample(s, `${where}.samples[${j}]`))
    };
  });

  const seen = new Map<string, string>();
  for (const [i, exam] of exams.entries()) {
    const id = examId(exam);
    if (seen.has(id)) {
      throw new ManifestError(`manifest: exams[${i}]: duplicate exam ${id}`);
    }
    seen.set(id, `exams[${i}]`);
    for (const [j, s] of exam.samples.entries()) {
      const stem = sampleStem(exam, s);
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
