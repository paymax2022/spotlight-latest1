import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import React, {useRef, useState} from 'react';
import {
  responsiveHeight,
  responsiveWidth,
} from 'react-native-responsive-dimensions';
import {SafeAreaView} from 'react-native-safe-area-context';

import {components} from '../components';
import {theme} from '../constants';

const onboardingData = [
  {
    id: 1,
    title: 'Welcome to Apitex\nbank app!',
    description:
      'Labore sunt culpa excepteur culpa ipsum. Labore occaecat ex nisi mollit.',
    image: require('../assets/images/01.png'),
  },
  {
    id: 2,
    title: 'Get a new card in a\nfew clicks!',
    description:
      'Labore sunt culpa excepteur culpa ipsum. Labore occaecat ex nisi mollit.',
    image: require('../assets/images/01.png'),
  },
  {
    id: 3,
    title: 'Easy payments all\nover the world!',
    description:
      'Labore sunt culpa excepteur culpa ipsum. Labore occaecat ex nisi mollit.',
    image: require('../assets/images/01.png'),
  },
];

const Onboarding = ({navigation}) => {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const ref = useRef();

  const updateCurrentSlideIndex = (e) => {
    const contentOffsetX = e.nativeEvent.contentOffset.x;
    const currentIndex = Math.round(contentOffsetX / theme.sizes.width);
    setCurrentSlideIndex(currentIndex);
  };

  const renderStatusBar = () => {
    return (
      <StatusBar
        barStyle='light-content'
        translucent={true}
        backgroundColor={theme.colors.transparent}
      />
    );
  };

  const renderImageBackground = () => {
    return (
      <components.Image
        source={require('../assets/bg/03.png')}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
        }}
      />
    );
  };

  const renderSlides = () => {
    return (
      <ScrollView
        ref={ref}
        horizontal={true}
        pagingEnabled={true}
        onMomentumScrollEnd={updateCurrentSlideIndex}
        contentContainerStyle={{
          paddingTop: responsiveHeight(3),
          paddingBottom: responsiveHeight(4),
        }}
        style={{
          flexGrow: 0,
        }}
        showsHorizontalScrollIndicator={false}
      >
        {onboardingData.map((item, index) => {
          return (
            <View key={index} style={{width: theme.sizes.width}}>
              <components.Image
                source={item.image}
                style={{
                  width: responsiveWidth(64),
                  height: responsiveHeight(48),
                  alignSelf: 'center',
                }}
                resizeMode={'contain'}
              />
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderContent = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        {onboardingData.map((item, index) => {
          return (
            <View key={index}>
              {currentSlideIndex === index && (
                <View>
                  <Text
                    style={{
                      color: theme.colors.white,
                      ...theme.fonts.SourceSansPro_SemiBold_32,
                      lineHeight:
                        theme.fonts.SourceSansPro_SemiBold_32.fontSize * 1.2,
                      marginBottom: theme.sizes.marginBottom_14,
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: '#B4B4C6',
                      ...theme.fonts.SourceSansPro_Regular_16,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
                    }}
                  >
                    {item.description}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const renderDots = () => {
    return (
      <View style={{paddingHorizontal: 20, flex: 1, justifyContent: 'center'}}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          {onboardingData.map((item, index) => {
            return (
              <View
                key={index}
                style={{
                  width: theme.sizes.width_20,
                  height: 2,
                  marginRight: 10,
                  backgroundColor: theme.colors.white,
                  opacity: currentSlideIndex === index ? 1 : 0.3,
                }}
              />
            );
          })}
        </View>
      </View>
    );
  };

  const renderButton = () => {
    return (
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: responsiveHeight(2),
        }}
      >
        <TouchableOpacity
          style={{
            width: responsiveWidth(40),
            backgroundColor: '#FFD9C3',
            paddingVertical: responsiveHeight(1.5),
            justifyContent: 'center',
            alignItems: 'center',
            borderRadius: responsiveHeight(1),
          }}
          onPress={() => {
            navigation.navigate('SignIn');
            // navigation.navigate('SignInCode');
          }}
        >
          <Text
            style={{
              color: theme.colors.mainDark,
              ...theme.fonts.SourceSansPro_SemiBold_16,
            }}
          >
            Get Started
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{flex: 1, backgroundColor: theme.colors.mainDark}}>
      {renderImageBackground()}
      <SafeAreaView edges={['top', 'bottom']} style={{flex: 1}}>
        {renderStatusBar()}
        {renderSlides()}
        {renderContent()}
        {renderDots()}
        {renderButton()}
      </SafeAreaView>
    </View>
  );
};

export default Onboarding;
