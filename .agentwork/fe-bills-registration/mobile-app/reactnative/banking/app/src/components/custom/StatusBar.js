import {StatusBar as RNStatusBar} from 'react-native';
import React from 'react';

const StatusBar = () => {
  return (
    <RNStatusBar
      barStyle='dark-content'
      backgroundColor='transparent'
      translucent={true}
    />
  );
};

export default StatusBar;
