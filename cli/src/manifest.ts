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
  // human judging criteria for reproductions of this figure, one per item
  readonly checklist?: readonly string[];
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

function parseText(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestError(`manifest: ${where}: expected a non-empty string`);
  }
  return value;
}

function parseNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ManifestError(`manifest: ${where}: expected a number`);
  }
  return value;
}

function parseInteger(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ManifestError(`manifest: ${where}: expected an integer >= 1`);
  }
  return value;
}

function parseDigest(value: unknown, where: string): string {
  const digest = parseText(value, where);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new ManifestError(`manifest: ${where}: expected a lowercase hex sha256`);
  }
  return digest;
}

function parseBox(value: unknown, where: string): Box {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const { x, y, w, h, ...extra } = value as Record<string, unknown>;
  const [unexpected] = Object.keys(extra);
  if (unexpected) throw new ManifestError(`manifest: ${where}.${unexpected}: unexpected field`);
  const box = {
    x: parseNumber(x, `${where}.x`),
    y: parseNumber(y, `${where}.y`),
    w: parseNumber(w, `${where}.w`),
    h: parseNumber(h, `${where}.h`)
  };
  if (box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0) {
    throw new ManifestError(`manifest: ${where}: box must have positive size`);
  }
  if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001) {
    throw new ManifestError(`manifest: ${where}: box must lie within the page`);
  }
  return box;
}

function parseSample(value: unknown, where: string): Sample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const {
    question,
    option: optionValue,
    role: roleValue,
    index,
    page,
    box,
    masks: maskValues,
    category: categoryValue,
    checklist,
    output,
    ...extra
  } = value as Record<string, unknown>;
  const [unexpected] = Object.keys(extra);
  if (unexpected) throw new ManifestError(`manifest: ${where}.${unexpected}: unexpected field`);

  const role = ROLES.find((r) => r === parseText(roleValue, `${where}.role`));
  if (!role) {
    throw new ManifestError(`manifest: ${where}.role: expected one of ${ROLES.join(", ")}`);
  }

  const option = optionValue === undefined ? undefined : parseText(optionValue, `${where}.option`);
  if ((role === "answer_option") !== (option !== undefined)) {
    throw new ManifestError(
      `manifest: ${where}: answer_option samples, and only those, carry an option`
    );
  }

  let masks: readonly unknown[] | undefined;
  if (maskValues !== undefined) {
    if (!Array.isArray(maskValues)) {
      throw new ManifestError(`manifest: ${where}.masks: expected an array`);
    }
    masks = maskValues;
  }

  const category = CATEGORIES.find((c) => c === parseText(categoryValue, `${where}.category`));
  if (!category) {
    throw new ManifestError(
      `manifest: ${where}.category: expected one of ${CATEGORIES.join(", ")}`
    );
  }

  return {
    question: parseText(question, `${where}.question`),
    option,
    role,
    index: parseInteger(index, `${where}.index`),
    page: parseInteger(page, `${where}.page`),
    box: parseBox(box, `${where}.box`),
    masks: masks?.map((m, i) => parseBox(m, `${where}.masks[${i}]`)),
    category,
    checklist:
      checklist === undefined ? undefined : parseChecklist(checklist, `${where}.checklist`),
    output: output === undefined ? undefined : parseOutput(output, `${where}.output`)
  };
}

function parseChecklist(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ManifestError(`manifest: ${where}: expected a non-empty array`);
  }
  const items = value.map((item, i) => parseText(item, `${where}[${i}]`));
  if (new Set(items).size !== items.length) {
    throw new ManifestError(`manifest: ${where}: items must be unique`);
  }
  return items;
}

function parseOutput(value: unknown, where: string): SampleOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const { width, height, sha256, ...extra } = value as Record<string, unknown>;
  const [unexpected] = Object.keys(extra);
  if (unexpected) throw new ManifestError(`manifest: ${where}.${unexpected}: unexpected field`);
  return {
    width: parseInteger(width, `${where}.width`),
    height: parseInteger(height, `${where}.height`),
    sha256: parseDigest(sha256, `${where}.sha256`)
  };
}

function parseExam(value: unknown, where: string): Exam {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest: ${where}: expected an object`);
  }
  const {
    course: courseValue,
    year,
    url,
    sha256,
    samples,
    ...extra
  } = value as Record<string, unknown>;
  const [unexpected] = Object.keys(extra);
  if (unexpected) throw new ManifestError(`manifest: ${where}.${unexpected}: unexpected field`);
  if (!Array.isArray(samples)) {
    throw new ManifestError(`manifest: ${where}.samples: expected an array`);
  }
  const sampleValues: readonly unknown[] = samples;
  const course = COURSES.find((c) => c === parseText(courseValue, `${where}.course`));
  if (!course) {
    throw new ManifestError(`manifest: ${where}.course: expected one of ${COURSES.join(", ")}`);
  }
  return {
    course,
    year: parseInteger(year, `${where}.year`),
    url: parseText(url, `${where}.url`),
    sha256: parseDigest(sha256, `${where}.sha256`),
    samples: sampleValues.map((s, j) => parseSample(s, `${where}.samples[${j}]`))
  };
}

export function parseManifest(json: unknown): Exam[] {
  if (!Array.isArray(json)) {
    throw new ManifestError("manifest: root: expected an array of exams");
  }
  const values: readonly unknown[] = json;
  const exams = values.map((value, i) => parseExam(value, `exams[${i}]`));

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
