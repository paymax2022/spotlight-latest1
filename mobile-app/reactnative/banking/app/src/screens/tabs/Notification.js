import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';

import {theme} from '../../constants';
import {svg} from '../../assets/svg';

const notifications = [
  {
    id: 1,
    title: 'Your loan application has been approved!',
    status: 'completed',
    date: 'Apr 12, 2023 at 12:47 PM',
  },
  {
    id: 2,
    title: 'The loan repayment period expires!',
    description:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    status: 'alert',
    date: 'Apr 12, 2023 at 12:47 PM',
  },
  {
    id: 3,
    title: 'Your loan application was rejected!',
    description:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    status: 'rejected',
    date: 'Apr 12, 2023 at 12:47 PM',
  },
  {
    id: 4,
    title: 'Your piggy bank is full!',
    status: 'completed',
    date: 'Apr 12, 2023 at 12:47 PM',
  },
];

const Notification = () => {
  const renderHeader = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_SemiBold_28,
            lineHeight: theme.fonts.SourceSansPro_Regular_28.fontSize * 1.2,
            marginBottom: theme.sizes.marginBottom_20,
            color: theme.colors.mainDark,
            marginTop: theme.sizes.marginTop_40,
          }}
        >
          Notifications
        </Text>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingBottom: theme.sizes.paddingBottom_20,
        }}
      >
        {notifications.map((item, index, array) => {
          const last = array.length - 1 === index;

          return (
            <TouchableOpacity
              key={index}
              style={{
                backgroundColor: theme.colors.white,
                marginBottom: last ? 0 : 10,
                padding: 20,
                borderRadius: 10,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 14,
                }}
              >
                {item.status === 'completed' && (
                  <View style={{marginRight: 8}}>
                    <svg.CompletedNoticeSvg />
                  </View>
                )}
                {item.status === 'alert' && (
                  <View style={{marginRight: 8}}>
                    <svg.AlertSvg />
                  </View>
                )}
                {item.status === 'rejected' && (
                  <View style={{marginRight: 8}}>
                    <svg.RejectedSvg />
                  </View>
                )}
                <Text
                  style={{
                    ...theme.fonts.SourceSansPro_Regular_16,
                    lineHeight:
                      theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
                    color: theme.colors.mainDark,
                  }}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
              </View>
              {item.description && (
                <Text
                  style={{
                    marginBottom: 14,
                    ...theme.fonts.SourceSansPro_Regular_16,
                    lineHeight:
                      theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
                    color: theme.colors.bodyTextColor,
                  }}
                >
                  {item.description}
                </Text>
              )}
              <Text
                style={{
                  ...theme.fonts.SourceSansPro_Regular_12,
                  lineHeight:
                    theme.fonts.SourceSansPro_Regular_12.fontSize * 1.6,
                  color: theme.colors.bodyTextColor,
                }}
              >
                {item.date}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <View style={{flex: 1}}>
      {renderHeader()}
      {renderContent()}
    </View>
  );
};

export default Notification;
