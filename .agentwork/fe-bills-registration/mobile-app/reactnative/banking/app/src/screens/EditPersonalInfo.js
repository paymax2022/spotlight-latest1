import {View, Text, TouchableOpacity} from 'react-native';
import React from 'react';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {
  responsiveHeight,
  responsiveWidth,
  responsiveFontSize,
} from 'react-native-responsive-dimensions';
import PhoneInput from 'react-native-phone-input';

import {components} from '../components';
import {theme} from '../constants';

const EditPersonalInfo = ({navigation}) => {
  const renderHeader = () => {
    return <components.Header goBack title='Edit personal info' />;
  };

  const renderContent = () => {
    return (
      <KeyboardAwareScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: theme.sizes.paddingBottom_20,
          marginTop: theme.sizes.marginTop_10,
        }}
        enableOnAndroid={true}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={{
            marginBottom: theme.sizes.marginBottom_30,
          }}
        >
          <components.ImageBackground
            style={{
              alignSelf: 'center',
              width: responsiveHeight(9),
              aspectRatio: 1 / 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
            source={{uri: 'https://george-fx.github.io/apitex/users/01.png'}}
          >
            <View
              style={{
                backgroundColor: '#1B1D4D',
                position: 'absolute',
                width: '100%',
                height: '100%',
                opacity: 0.5,
                borderRadius: responsiveHeight(9) / 2,
              }}
            />
            <components.Image
              source={require('../assets/icons/camera.png')}
              style={{
                width: 24,
                height: 20,
                resizeMode: 'cover',
              }}
              resizeMode={'contain'}
            />
          </components.ImageBackground>
        </TouchableOpacity>
        <components.InputField
          placeholder={'Henderson'}
          containerStyle={{
            marginBottom: theme.sizes.marginBottom_10,
          }}
          userIcon={true}
        />
        <View
          style={{
            borderWidth: 1,
            marginBottom: theme.sizes.marginBottom_10,
            borderColor: '#FFEFE6',
            backgroundColor: theme.colors.white,
            borderRadius: 10,
          }}
        >
          <PhoneInput
            style={{
              paddingHorizontal: 10,
              height: 50,
            }}
            initialCountry={'us'}
            initialValue='123456789'
            textStyle={{
              ...theme.fonts.SourceSansPro_Regular_16,
              color: theme.colors.mainDark,
            }}
          />
        </View>
        <components.InputField
          placeholder={'Enter your email'}
          containerStyle={{
            marginBottom: theme.sizes.marginBottom_10,
          }}
          emailIcon={true}
        />
        <components.InputField
          placeholder='MM/DD/YYYY'
          containerStyle={{
            marginBottom: theme.sizes.marginBottom_10,
          }}
          calendarIcon={true}
        />
        <components.InputField
          placeholder='Enter your address'
          containerStyle={{
            marginBottom: theme.sizes.marginBottom_14,
          }}
          mapPinIcon={true}
        />
        <components.Button
          title='Save'
          onPress={() => {
            navigation.navigate('Profile');
          }}
        />
      </KeyboardAwareScrollView>
    );
  };

  return (
    <components.SafeAreaView background={true}>
      {renderHeader()}
      {renderContent()}
    </components.SafeAreaView>
  );
};

export default EditPersonalInfo;
