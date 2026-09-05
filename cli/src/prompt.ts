import { render, RendererError } from "./render.ts";

const TEX_CAP_PLACEHOLDER = "{{TEX_CAPABILITIES}}";

export const TEX_PACKAGES = ["tikz", "pgfplots", "amsmath"] as const;
export const TIKZ_LIBRARIES = [
  "calc",
  "arrows.meta",
  "angles",
  "quotes",
  "patterns",
  "patterns.meta",
  "decorations.markings"
] as const;

export function formatTexCapabilities(): string {
  return [
    `Packages (\\usepackage): ${TEX_PACKAGES.join(", ")}`,
    `TikZ libraries (\\usetikzlibrary): ${TIKZ_LIBRARIES.join(", ")}`
  ].join("\n");
}

export function buildSystemPrompt(template: string): string {
  if (!template.includes(TEX_CAP_PLACEHOLDER)) {
    throw new Error(`system prompt is missing the ${TEX_CAP_PLACEHOLDER} placeholder`);
  }
  return template.replaceAll(TEX_CAP_PLACEHOLDER, formatTexCapabilities());
}

export function buildTestDocument(): string {
  return [
    "\\documentclass[tikz,border=6pt]{standalone}",
    ...TEX_PACKAGES.map((p) => `\\usepackage{${p}}`),
    `\\usetikzlibrary{${TIKZ_LIBRARIES.join(",")}}`,
    "\\pgfplotsset{compat=newest}",
    "\\begin{document}",
    "\\begin{tikzpicture}\\end{tikzpicture}",
    "\\end{document}",
    ""
  ].join("\n");
}

export async function checkTexCapabilities(container: string): Promise<void> {
  const result = await render(container, buildTestDocument());
  if (!result.ok) {
    throw new RendererError(
      `renderer cannot load packages advertised in the prompt:\n${result.message}`
    );
  }
}
