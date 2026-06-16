import {View, Text, TouchableOpacity} from 'react-native';
import React from 'react';

import {theme} from '../constants';
import {svg} from '../assets/svg';

const BlockHeading = ({title, onPress, containerStyle, icon}) => {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginBottom: 14,
        ...containerStyle,
      }}
    >
      <Text
        style={{
          ...theme.fonts.SourceSansPro_Regular_16,
          lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
          color: theme.colors.mainDark,
        }}
      >
        {title}
      </Text>
      <TouchableOpacity
        onPress={onPress}
        style={{flexDirection: 'row', alignItems: 'center'}}
      >
        {icon}
      </TouchableOpacity>
    </View>
  );
};

export default BlockHeading;
