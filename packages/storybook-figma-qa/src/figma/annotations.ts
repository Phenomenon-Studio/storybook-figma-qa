// Designer notes of a story's results, flattened for `report --json`: the list its human output counts. Notes never
// reach a verdict (verdict.ts reads none of this).
import type { FigmaBlockResult, StoryAnnotation } from './types.ts';

/** Every note of the blocks in order: each block's set-level notes, then its cells' notes in cell order. */
export function storyAnnotations(blocks: readonly FigmaBlockResult[]): StoryAnnotation[] {
    return blocks.flatMap((block) => {
        const onSet = (block.annotations ?? []).map(({ variant: _variant, ...note }) => {
            return { block: block.set.name, variant: null, ...note };
        });
        const onCells = block.cells.flatMap((cell) => {
            return cell.annotations.map(({ variant: _variant, ...note }) => {
                return { block: block.set.name, variant: cell.variant.name, ...note };
            });
        });

        return [...onSet, ...onCells];
    });
}
