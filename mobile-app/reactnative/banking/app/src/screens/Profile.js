import {View, Text, TouchableOpacity, ScrollView} from 'react-native';
import React from 'react';
import {
  responsiveHeight,
  responsiveFontSize,
} from 'react-native-responsive-dimensions';
import FitImage from 'react-native-fit-image';

import {components} from '../components';
import {theme} from '../constants';
import {svg} from '../assets/svg';

const Profile = ({navigation}) => {
  const renderHeader = () => {
    return <components.Header goBack title='Profile' />;
  };

  const renderContent = () => {
    return (
      <ScrollView contentContainerStyle={{flexGrow: 1, paddingHorizontal: 20}}>
        <TouchableOpacity
          style={{
            marginTop: theme.sizes.marginTop_46,
            marginBottom: theme.sizes.marginBottom_14,
          }}
          onPress={() => {
            navigation.navigate('EditPersonalInfo');
          }}
        >
          <components.Image
            style={{
              alignSelf: 'center',
              width: responsiveHeight(10.4),
              aspectRatio: 1,
            }}
            source={{uri: 'https://george-fx.github.io/apitex/users/01.png'}}
          />
        </TouchableOpacity>
        <Text
          style={{
            textAlign: 'center',
            ...theme.fonts.SourceSansPro_Regular_18,
            lineHeight: theme.fonts.SourceSansPro_Regular_18.fontSize * 1.2,
            color: theme.colors.mainDark,
            textTransform: 'capitalize',
            marginBottom: theme.sizes.marginBottom_4,
          }}
        >
          Briley Henderson
        </Text>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
            textAlign: 'center',
            color: theme.colors.bodyTextColor,
            marginBottom: theme.sizes.marginBottom_30,
          }}
        >
          +17 123 456 7890
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#FFF7F2',
            borderRadius: 10,
            paddingLeft: 10,
            paddingVertical: 10,
            paddingRight: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
          onPress={() => navigation.navigate('EditPersonalInfo')}
        >
          <components.Image
            source={require('../assets/icons/user.png')}
            style={{
              width: responsiveHeight(5),
              aspectRatio: 1,
              marginRight: 10,
            }}
          />
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
              textTransform: 'capitalize',
              marginRight: 'auto',
            }}
            numberOfLines={1}
          >
            Personal Info
          </Text>
          <svg.RightArrowSvg />
        </TouchableOpacity>
        <View
          style={{
            backgroundColor: '#FFF7F2',
            borderRadius: 10,
            paddingLeft: 10,
            paddingVertical: 10,
            paddingRight: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <components.Image
            source={require('../assets/icons/message.png')}
            style={{
              width: responsiveHeight(5),
              aspectRatio: 1,
              marginRight: 10,
            }}
          />
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
              textTransform: 'capitalize',
              marginRight: 'auto',
            }}
            numberOfLines={1}
          >
            Notifications
          </Text>
          <components.SwitchButton />
        </View>
        <View
          style={{
            backgroundColor: '#FFF7F2',
            borderRadius: 10,
            paddingLeft: 10,
            paddingVertical: 10,
            paddingRight: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <components.Image
            source={require('../assets/icons/scan2.png')}
            style={{
              width: responsiveHeight(5),
              aspectRatio: 1,
              marginRight: 10,
            }}
          />
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
              textTransform: 'capitalize',
              marginRight: 'auto',
            }}
            numberOfLines={1}
          >
            Face ID
          </Text>
          <components.SwitchButton />
        </View>
        <TouchableOpacity
          style={{
            backgroundColor: '#FFF7F2',
            borderRadius: 10,
            paddingLeft: 10,
            paddingVertical: 10,
            paddingRight: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <components.Image
            source={require('../assets/icons/language.png')}
            style={{
              width: responsiveHeight(5),
              aspectRatio: 1,
              marginRight: 10,
            }}
          />
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
              textTransform: 'capitalize',
              marginRight: 'auto',
            }}
            numberOfLines={1}
          >
            Language
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text
              style={{
                marginRight: 11.29,
                ...theme.fonts.SourceSansPro_Regular,
                fontSize: responsiveFontSize(1.8),
                lineHeight: responsiveFontSize(1.8) * 1.6,
                color: theme.colors.bodyTextColor,
              }}
            >
              Eng
            </Text>
            <svg.RightArrowSvg />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            backgroundColor: '#FFF7F2',
            borderRadius: 10,
            paddingLeft: 10,
            paddingVertical: 10,
            paddingRight: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
          onPress={() => {
            navigation.navigate('ExchangeRates');
          }}
        >
          <components.Image
            source={require('../assets/icons/repeat.png')}
            style={{
              width: responsiveHeight(5),
              aspectRatio: 1,
              marginRight: 10,
            }}
          />
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
              textTransform: 'capitalize',
              marginRight: 'auto',
            }}
            numberOfLines={1}
          >
            Exchange Rates
          </Text>
          <svg.RightArrowSvg />
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const renderButton = () => {
    return (
      <components.Button
        title='Log out'
        lightShade={true}
        containerStyle={{padding: 20}}
        onPress={() => {
          navigation.navigate('SignIn');
        }}
      />
    );
  };

  return (
    <components.SafeAreaView>
      {renderHeader()}
      {renderContent()}
      {renderButton()}
    </components.SafeAreaView>
  );
};

export default Profile;
