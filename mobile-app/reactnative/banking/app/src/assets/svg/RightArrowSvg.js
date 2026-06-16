import * as React from 'react';
import Svg, {G, Path, Defs, ClipPath} from 'react-native-svg';

const RightArrowSvg = () => (
  <Svg xmlns='http://www.w3.org/2000/svg' width={6} height={10} fill='none'>
    <G clipPath='url(#a)'>
      <Path
        stroke='#6C6D84'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={1.5}
        d='M.714 9.571 5 5.286.714 1'
      />
    </G>
    <Defs>
      <ClipPath id='a'>
        <Path fill='#fff' d='M6 0H.286v10H6z' />
      </ClipPath>
    </Defs>
  </Svg>
);

export default RightArrowSvg;
