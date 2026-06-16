import * as React from 'react';
import Svg, {G, Path, Defs, ClipPath} from 'react-native-svg';

const GoBackSvg = ({color = '#142535'}) => (
  <Svg width={8} height={14} fill='none' xmlns='http://www.w3.org/2000/svg'>
    <G clipPath='url(#a)'>
      <Path
        d='M7 13 1 7l6-6'
        stroke={color}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </G>
    <Defs>
      <ClipPath id='a'>
        <Path fill='#fff' d='M0 0h8v14H0z' />
      </ClipPath>
    </Defs>
  </Svg>
);

export default GoBackSvg;
