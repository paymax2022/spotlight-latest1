import {View, Text, TouchableOpacity, StatusBar} from 'react-native';
import React from 'react';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import ParsedText from 'react-native-parsed-text';

import {components} from '../../components';
import {svg} from '../../assets/svg';
import {theme} from '../../constants';

const SignUp = ({navigation}) => {
  const handleSignIn = () => {
    navigation.navigate('SignIn');
  };

  const renderStatusBar = () => {
    return (
      <StatusBar barStyle='dark-content' backgroundColor={theme.colors.white} />
    );
  };

  const renderHeader = () => {
    return <components.Header goBack={true} />;
  };

  const renderContent = () => {
    return (
      <KeyboardAwareScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
        }}
        enableOnAndroid={true}
      >
        <Text
          style={{
            ...theme.fonts.SourceSansPro_SemiBold_32,
            lineHeight: theme.fonts.SourceSansPro_SemiBold_32.fontSize * 1.2,
            color: theme.colors.mainDark,
            marginBottom: theme.sizes.marginBottom_30,
          }}
        >
          Sign up!
        </Text>
        <components.InputField
          placeholder='Briley Henderson'
          userIcon={true}
          containerStyle={{marginBottom: theme.sizes.marginBottom_10}}
        />
        <components.InputField
          placeholder='Enter your email'
          emailIcon={true}
          containerStyle={{marginBottom: theme.sizes.marginBottom_10}}
        />
        <components.InputField
          placeholder='Enter your password'
          keyIcon={true}
          eyeOffIcon={true}
          secureTextEntry={true}
          containerStyle={{marginBottom: theme.sizes.marginBottom_10}}
        />
        <components.InputField
          placeholder='Confirm your password'
          keyIcon={true}
          eyeOffIcon={true}
          secureTextEntry={true}
          containerStyle={{marginBottom: theme.sizes.marginBottom_14}}
        />
        <components.Button
          title='Sign up'
          onPress={() => {
            navigation.navigate('VerifyYourPhoneNumber');
          }}
          containerStyle={{marginBottom: theme.sizes.marginBottom_30}}
        />
        <ParsedText
          style={{
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
          }}
          parse={[
            {
              pattern: /Sign in./,
              style: {color: theme.colors.mainColor},
              onPress: handleSignIn,
            },
          ]}
        >
          Already have an account? Sign in.
        </ParsedText>
      </KeyboardAwareScrollView>
    );
  };

  const renderFooter = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
            paddingTop: theme.sizes.marginTop_10,
          }}
        >
          Log in with social networks
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 20,
            paddingTop: theme.sizes.paddingTop_20,
          }}
        >
          <TouchableOpacity
            style={{
              width: '31%',
              height: 40,
              backgroundColor: '#FFD9C3',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 8,
            }}
          >
            <svg.FacebookSvg />
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: '31%',
              height: 40,
              backgroundColor: '#FFD9C3',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 8,
            }}
          >
            <svg.TwitterSvg />
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: '31%',
              height: 40,
              backgroundColor: '#FFD9C3',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 8,
            }}
          >
            <svg.GoogleSvg />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <components.SafeAreaView background={true}>
      {renderStatusBar()}
      {renderHeader()}
      {renderContent()}
      {renderFooter()}
    </components.SafeAreaView>
  );
};

export default SignUp;
