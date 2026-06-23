import {View, Text, TouchableOpacity, ScrollView} from 'react-native';
import React from 'react';
import {responsiveWidth} from 'react-native-responsive-dimensions';
import {useNavigation} from '@react-navigation/native';

import {theme} from '../../constants';
import {components} from '../../components';

const moreOptions = [
  {
    id: 1,
    title: 'Add new card',
    icon: require('../../assets/icons/card.png'),
  },
  {
    id: 2,
    title: 'Create invoice',
    icon: require('../../assets/icons/edit.png'),
  },
  {
    id: 3,
    title: 'Statistics',
    icon: require('../../assets/icons/bar-chart.png'),
  },
  {
    id: 4,
    title: 'Scanner QR',
    icon: require('../../assets/icons/scan.png'),
  },
  {
    id: 5,
    title: 'FAQ',
    icon: require('../../assets/icons/faq.png'),
  },
  {
    id: 6,
    title: 'Support',
    icon: require('../../assets/icons/message.png'),
  },
  {
    id: 7,
    title: 'Charity',
    icon: require('../../assets/icons/heart.png'),
  },
  {
    id: 8,
    title: 'Privacy policy',
    icon: require('../../assets/icons/file.png'),
  },
];

const More = () => {
  const navigation = useNavigation();

  const renderHeader = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_SemiBold_28,
            lineHeight: theme.fonts.SourceSansPro_SemiBold_28.fontSize * 1.2,
            marginBottom: theme.sizes.marginBottom_20,
            color: theme.colors.mainDark,
            marginTop: theme.sizes.marginTop_40,
          }}
        >
          More
        </Text>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          justifyContent: 'space-between',
          flexDirection: 'row',
          flexWrap: 'wrap',
        }}
      >
        {moreOptions.map((option, index) => {
          const iconResponse = 8;

          return (
            <TouchableOpacity
              key={index}
              style={{
                width: responsiveWidth(43),
                backgroundColor: '#FFF6F2',
                marginBottom: 10,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: responsiveWidth(3.4),
                flexDirection: 'row',
                alignItems: 'center',
              }}
              onPress={() => {
                if (option.title === 'Add new card') {
                  navigation.navigate('OpenNewCard');
                }
                if (option.title === 'Create invoice') {
                  navigation.navigate('CreateInvoice');
                }
                if (option.title === 'Statistics') {
                  navigation.navigate('Statistics');
                }
                if (option.title === 'FAQ') {
                  navigation.navigate('FAQ');
                }
                if (option.title === 'Privacy policy') {
                  navigation.navigate('PrivacyPolicy');
                }
                if (option.title === 'Charity') {
                  navigation.navigate('Payments');
                }
                if (option.title === 'Support') {
                  console.log('Open something like chat');
                }
              }}
            >
              <components.Image
                source={option.icon}
                style={{
                  width: responsiveWidth(iconResponse),
                  height: responsiveWidth(iconResponse),
                }}
              />
              <Text
                style={{
                  marginLeft: 10,
                  ...theme.fonts.SourceSansPro_Regular_16,
                  lineHeight:
                    theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
                  color: theme.colors.mainDark,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {option.title}
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

export default More;
