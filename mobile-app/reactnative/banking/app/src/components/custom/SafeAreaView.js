import React from 'react';
import {View} from 'react-native';
import {SafeAreaView as SafeAreaViewRN} from 'react-native-safe-area-context';

import {theme} from '../../constants';
import {components} from '../../components';

const SafeAreaView = ({children, edges, background, safeAreaStyle}) => {
  if (background) {
    return (
      <View style={{backgroundColor: theme.colors.white, flex: 1}}>
        <SafeAreaViewRN
          style={{
            flex: 1,
            ...safeAreaStyle,
          }}
          edges={edges}
        >
          <components.ImageBackground
            source={require('../../assets/bg/01.png')}
            style={{
              flex: 1,
            }}
          >
            {children}
          </components.ImageBackground>
        </SafeAreaViewRN>
      </View>
    );
  }

  if (!background) {
    return (
      <SafeAreaViewRN
        style={{
          flex: 1,
          backgroundColor: theme.colors.white,
          ...safeAreaStyle,
        }}
        edges={edges}
      >
        {children}
      </SafeAreaViewRN>
    );
  }

  // return (
  //   <SafeAreaViewRN
  //     style={{flex: 1, backgroundColor: theme.colors.white, ...containerStyle}}
  //     edges={edges}
  //   >
  //     {!background && children}
  //     {background && (
  //       <components.ImageBackground
  //         source={require('../../assets/bg/01.png')}
  //         style={{
  //           flex: 1,
  //         }}
  //       >
  //         {children}
  //       </components.ImageBackground>
  //     )}
  //   </SafeAreaViewRN>
  // );
};

export default SafeAreaView;
