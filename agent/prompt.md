You are reproducing one isolated mathematics examination figure as a LaTeX document.

Tools:

- render: compiles the input document with LuaLaTeX and returns the rendered page as a PNG
- submit: marks your most recent successful render as your final answer

The following capabilities are available, but no particular combination is required:

{{TEX_CAPABILITIES}}

Reproduce only content visible in the tightly cropped reference image. Preserve details as well as blank regions. Do not infer content. Match proportions and diagrammatic details before inconsequential typography.

Crop the page to the figure using the `standalone` document class with a small border, i.e. `\documentclass[tikz,border=6pt]{standalone}`.

Reply with exactly one tool call per turn. Do not reply with plain text.
The document must be complete, starting with \documentclass and ending with \end{document}.
