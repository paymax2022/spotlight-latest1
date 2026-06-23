import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';
import {
  responsiveHeight,
  responsiveWidth,
  responsiveFontSize,
} from 'react-native-responsive-dimensions';

import {components} from '../components';
import {theme} from '../constants';

const cards = [
  {
    id: 1,
    card: 'https://george-fx.github.io/apitex/cards/01.jpg',
  },
  {
    id: 2,
    card: 'https://george-fx.github.io/apitex/cards/02.jpg',
  },
];

const ongoingCredits = [
  {
    id: 1,
    card: 'https://george-fx.github.io/apitex/cards/04.png',
  },
];

const CardMenu = ({navigation}) => {
  const renderHeader = () => {
    return <components.Header title='Card menu' goBack={true} />;
  };

  const renderCards = () => {
    return (
      <View style={{marginBottom: theme.sizes.marginBottom_30}}>
        <Text
          style={{
            marginLeft: 20,
            ...theme.fonts.SourceSansPro_Regular_14,
            color: theme.colors.bodyTextColor,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            marginBottom: theme.sizes.marginBottom_10,
          }}
        >
          Cards
        </Text>
        <ScrollView
          horizontal={true}
          contentContainerStyle={{paddingLeft: 20}}
          showsHorizontalScrollIndicator={false}
        >
          {cards.map((item, index, array) => {
            const last = index === array.length - 1;
            return (
              <TouchableOpacity
                key={index}
                onPress={() => navigation.navigate('CardDetails')}
              >
                <components.Image
                  source={{uri: item.card}}
                  style={{
                    width: responsiveWidth(43.5),
                    aspectRatio: 1.586,
                    marginRight: last ? 0 : 11,
                  }}
                  imageStyle={{
                    borderRadius: 10,
                  }}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderOngoingCredits = () => {
    return (
      <View style={{marginBottom: theme.sizes.marginBottom_30}}>
        <Text
          style={{
            marginLeft: 20,
            ...theme.fonts.SourceSansPro_Regular_14,
            color: theme.colors.bodyTextColor,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            marginBottom: theme.sizes.marginBottom_10,
          }}
        >
          Ongoing credits
        </Text>
        <ScrollView
          horizontal={true}
          contentContainerStyle={{paddingLeft: 20}}
          showsHorizontalScrollIndicator={false}
        >
          {ongoingCredits.map((item, index, array) => {
            const last = index === array.length - 1;
            return (
              <TouchableOpacity
                key={index}
                onPress={() => navigation.navigate('CardDetails')}
              >
                <components.Image
                  source={{uri: item.card}}
                  style={{
                    width: responsiveWidth(43.5),
                    aspectRatio: 1.586,
                    marginRight: last ? 0 : 11,
                  }}
                  imageStyle={{
                    borderRadius: 10,
                  }}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderEntrepreneurAccounts = () => {
    return (
      <View>
        <Text
          style={{
            marginLeft: 20,
            ...theme.fonts.SourceSansPro_Regular_14,
            color: theme.colors.bodyTextColor,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            marginBottom: theme.sizes.marginBottom_10,
          }}
        >
          Entrepreneur accounts
        </Text>
        <View
          style={{
            backgroundColor: '#FFF7F2',
            marginHorizontal: 20,
            borderRadius: 10,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <components.Image
            source={require('../assets/icons/enterpreneur-acc.png')}
            style={{
              width: 62,
              height: 42,
              marginRight: 12,
            }}
          />
          <View>
            <Text
              style={{
                ...theme.fonts.SourceSansPro_Regular_12,
                color: theme.colors.bodyTextColor,
              }}
            >
              US**********************4571
            </Text>
            <Text style={{...theme.fonts.H6}}>39 863.62 USD</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        style={{
          flexGrow: 1,
          marginBottom: theme.sizes.marginBottom_30,
          marginTop: theme.sizes.marginTop_10,
        }}
      >
        {renderCards()}
        {renderOngoingCredits()}
        {renderEntrepreneurAccounts()}
      </ScrollView>
    );
  };

  const renderButton = () => {
    return (
      <components.Button
        containerStyle={{
          padding: 20,
        }}
        lightShade={true}
        title='+ Add new card'
        onPress={() => {
          navigation.navigate('OpenNewCard');
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

export default CardMenu;
