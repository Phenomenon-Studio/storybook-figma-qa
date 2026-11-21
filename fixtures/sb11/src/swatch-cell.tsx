import type { RenderCell } from '@phenomenon-studio/storybook-figma-qa/preview';
import { Swatch } from './Swatch.tsx';

const TONES: Record<string, 'brand' | 'neutral' | undefined> = { Brand: 'brand', Neutral: 'neutral' };

/** Figma `Swatch` variant → code. Danger has no code tone: null reports the cell as missing. */
export const swatchCell: RenderCell = (props) => {
    const tone = TONES[props.Tone ?? ''];

    return tone ? <Swatch tone={tone} size={props.Size === 'Small' ? 'small' : 'large'} /> : null;
};

export const SWATCH_SET = 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=10-0';
