import React from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {
  responsiveHeight,
  responsiveWidth,
  responsiveFontSize,
} from 'react-native-responsive-dimensions';

import {components} from '../components';
import {svg} from '../assets/svg';
import {theme} from '../constants';

const Header = ({
  goBack,
  creditCard,
  user,
  title,
  containerStyle,
  titleStyle,
  goBackColor,
  file,
}) => {
  const navigation = useNavigation();

  const renderGoBack = () => {
    if (goBack) {
      return (
        <View style={{position: 'absolute', left: 0, alignItems: 'center'}}>
          <TouchableOpacity
            style={{
              paddingVertical: 12,
              paddingHorizontal: 20,
            }}
            onPress={() => navigation.goBack()}
          >
            <svg.GoBackSvg color={goBackColor} />
          </TouchableOpacity>
        </View>
      );
    } else {
      return null;
    }
  };

  const renderTitle = () => {
    if (title) {
      return (
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_18,
            lineHeight: theme.fonts.SourceSansPro_Regular_18.fontSize * 1.2,
            color: theme.colors.mainDark,
            ...titleStyle,
          }}
        >
          {title}
        </Text>
      );
    }

    if (!title) {
      return null;
    }
  };

  const renderCreditCard = () => {
    if (creditCard) {
      return (
        <TouchableOpacity
          style={{
            position: 'absolute',
            right: 0,
            paddingHorizontal: 20,
          }}
          onPress={() => navigation.navigate('CardMenu')}
        >
          <svg.CreditCardSvg />
        </TouchableOpacity>
      );
    }

    if (!creditCard) {
      return null;
    }
  };

  const renderUser = () => {
    if (user) {
      return (
        <TouchableOpacity
          style={{
            position: 'absolute',
            left: 0,
            alignItems: 'center',
            paddingHorizontal: 20,
            flexDirection: 'row',
          }}
          onPress={() => navigation.navigate('Profile')}
        >
          <components.Image
            source={{
              uri: 'https://george-fx.github.io/apitex/users/01.png',
            }}
            style={{
              width: responsiveWidth(7),
              marginRight: 10,
              aspectRatio: 1 / 1,
            }}
            imageStyle={{
              borderRadius: 13,
            }}
          />
          <Text
            style={{
              color: theme.colors.mainDark,
              ...theme.fonts.SourceSansPro_Regular_16,
              textTransform: 'capitalize',
            }}
          >
            Briley Henderson
          </Text>
        </TouchableOpacity>
      );
    }

    if (!user) {
      return null;
    }
  };

  const renderFile = () => {
    if (file) {
      return (
        <View style={{position: 'absolute', right: 0, alignItems: 'center'}}>
          <TouchableOpacity
            style={{
              paddingVertical: 12,
              paddingHorizontal: 20,
            }}
            onPress={() => {}}
          >
            <svg.FileTextSvg />
          </TouchableOpacity>
        </View>
      );
    } else {
      return null;
    }
  };

  return (
    <View
      style={{
        height: 47,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        ...containerStyle,
      }}
    >
      {renderGoBack()}
      {renderTitle()}
      {renderUser()}
      {renderFile()}
      {renderCreditCard()}
    </View>
  );
};

export default Header;
