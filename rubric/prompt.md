You write judging checklists for a benchmark in which models reproduce isolated mathematics examination figures as TikZ drawings. A human judge will later compare a reproduction against the original figure and mark each checklist item pass or fail, looking only at the two images.

Write a checklist for the figure in the image. Each item must be:

- one binary claim about the figure's content or structure, phrased as a pass condition;
- verifiable by eye from the image alone, without the exam question text; and
- about what is drawn, not how it is styled: ignore line weight, font, colour, and exact sizing unless proportions are the point of the figure

Cover the elements a competent reproduction must get right: axes and their labels, key points and intercepts, shapes and their relationships, labels and annotations, shading, arrows, and any blank regions that matter.

Reply with a JSON array of strings, one per item, and nothing else.
