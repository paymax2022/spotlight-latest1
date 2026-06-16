import {View, TouchableOpacity, StatusBar, Text} from 'react-native';
import React from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {setScreen} from '../store/tabSlice';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {components} from '../components';
import {svg} from '../assets/svg';

import Dashboard from '../screens/tabs/Dashboard';
import Deposits from '../screens/tabs/Deposits';
import Loans from '../screens/tabs/Loans';
import Notification from '../screens/tabs/Notification';
import More from '../screens/tabs/More';
import {theme} from '../constants';

const TabNavigator = () => {
  const dispatch = useDispatch();
  const currentTabScreen = useSelector((state) => state.tab.screen);
  const insets = useSafeAreaInsets();
  const homeIndicatorHeight = insets.bottom;

  const tabs = [
    {
      name: 'Dashboard',
      icon: svg.DashboardSvg,
    },
    {
      name: 'Deposits',
      icon: svg.WalletSvg,
    },
    {
      name: 'Loans',
      icon: svg.PercentageSvg,
    },
    {
      name: 'Notification',
      icon: svg.NotificationSvg,
    },
    {
      name: 'More',
      icon: svg.MoreSvg,
    },
  ];

  const renderStatusBar = () => {
    return (
      <StatusBar barStyle='dark-content' backgroundColor={theme.colors.white} />
    );
  };

  const homeIndicatorSettings = () => {
    if (homeIndicatorHeight !== 0) {
      return homeIndicatorHeight;
    }
    if (homeIndicatorHeight === 0) {
      return 20;
    }
  };

  const renderHeader = () => {
    if (currentTabScreen === 'Dashboard') {
      return (
        <components.Header
          creditCard={currentTabScreen === 'Dashboard' && true}
          user={currentTabScreen === 'Dashboard' && true}
        />
      );
    }
  };

  const renderScreen = () => {
    return (
      <View style={{flex: 1}}>
        {currentTabScreen === 'Dashboard' && <Dashboard />}
        {currentTabScreen === 'Deposits' && <Deposits />}
        {currentTabScreen === 'Loans' && <Loans />}
        {currentTabScreen === 'Notification' && <Notification />}
        {currentTabScreen === 'More' && <More />}
      </View>
    );
  };

  const renderBottomTab = () => {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: theme.colors.mainDark,
          borderRadius: 14,
          height: 63,
          paddingHorizontal: 10,
          marginHorizontal: 20,
          marginBottom: homeIndicatorSettings(),
        }}
      >
        {tabs.map((tab, index) => {
          return (
            <TouchableOpacity
              key={index}
              style={{
                paddingHorizontal: 16,
                height: '100%',
                justifyContent: 'center',
              }}
              onPress={() => dispatch(setScreen(tab.name))}
            >
              <View>
                <tab.icon
                  color={
                    currentTabScreen === tab.name
                      ? theme.colors.mainColor
                      : theme.colors.white
                  }
                />
                {tab.name === 'Notification' &&
                  currentTabScreen !== 'Notification' && (
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 8 / 2,
                        right: 0,
                        top: 0,
                        backgroundColor: theme.colors.mainColor,
                        position: 'absolute',
                      }}
                    />
                  )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <components.SafeAreaView
      edges={['top']}
      background={currentTabScreen === 'Notification' ? true : false}
    >
      {renderStatusBar()}
      {renderHeader()}
      {renderScreen()}
      {renderBottomTab()}
    </components.SafeAreaView>
  );
};

export default TabNavigator;
