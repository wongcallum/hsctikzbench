import type { Category, Role } from "hsctikzbench-cli/manifest";

export interface SampleSummary {
  stem: string;
  exam: string;
  question: string;
  option: string | null;
  role: Role;
  category: Category;
  checklist: string[] | null;
  hasCrop: boolean;
}
