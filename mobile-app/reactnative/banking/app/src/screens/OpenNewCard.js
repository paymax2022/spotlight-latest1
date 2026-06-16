import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React, {useState} from 'react';
import {
  responsiveHeight,
  responsiveWidth,
} from 'react-native-responsive-dimensions';

import {components} from '../components';
import {theme} from '../constants';

const cards = [
  'https://george-fx.github.io/apitex/cards/01.jpg',
  'https://george-fx.github.io/apitex/cards/02.jpg',
];

const OpenNewCard = ({navigation}) => {
  const [type, setType] = useState('debet');
  const [currency, setCurrency] = useState('USD');
  const [paymentSystem, setPaymentSystem] = useState('Visa');

  const renderHeader = () => {
    return <components.Header goBack={true} title='Open new card' />;
  };

  const renderType = () => {
    return (
      <View
        style={{
          paddingHorizontal: 20,
          marginBottom: theme.sizes.marginBottom_30,
        }}
      >
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_10,
            color: theme.colors.bodyTextColor,
          }}
        >
          Type
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                type === 'debet' ? theme.colors.mainDark : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setType('debet')}
          >
            <Text
              style={{
                color:
                  type === 'debet' ? theme.colors.white : theme.colors.mainDark,
                ...theme.fonts.SourceSansPro_Regular_14,
                textTransform: 'capitalize',
              }}
            >
              Debet
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                type === 'credit' ? theme.colors.mainDark : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setType('credit')}
          >
            <Text
              style={{
                color:
                  type === 'credit'
                    ? theme.colors.white
                    : theme.colors.mainDark,
                ...theme.fonts.SourceSansPro_Regular_14,
              }}
            >
              Credit
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCurrency = () => {
    return (
      <View
        style={{
          paddingHorizontal: 20,
          marginBottom: theme.sizes.marginBottom_30,
        }}
      >
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_10,
            color: theme.colors.bodyTextColor,
          }}
        >
          Choose currency
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                currency === 'USD' ? theme.colors.mainDark : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setCurrency('USD')}
          >
            <Text
              style={{
                color:
                  currency === 'USD'
                    ? theme.colors.white
                    : theme.colors.mainDark,
                textTransform: 'uppercase',
                ...theme.fonts.SourceSansPro_Regular_14,
              }}
            >
              USD
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                currency === 'EUR' ? theme.colors.mainDark : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setCurrency('EUR')}
          >
            <Text
              style={{
                color:
                  currency === 'EUR'
                    ? theme.colors.white
                    : theme.colors.mainDark,
                fontSize: 14,
                ...theme.fonts.SourceSansPro_Regular_14,
                textTransform: 'uppercase',
              }}
            >
              EUR
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderPaymentSystem = () => {
    return (
      <View
        style={{
          paddingHorizontal: 20,
          marginBottom: theme.sizes.marginBottom_30,
        }}
      >
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_10,
            color: theme.colors.bodyTextColor,
          }}
        >
          Payment system
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                paymentSystem === 'Visa'
                  ? theme.colors.mainDark
                  : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setPaymentSystem('Visa')}
          >
            <components.Image
              source={{
                uri: 'https://george-fx.github.io/apitex/payment/01.png',
              }}
              style={{width: 40.43, height: 12}}
              tintColor={
                paymentSystem === 'Visa'
                  ? theme.colors.white
                  : theme.colors.mainDark
              }
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: responsiveWidth(48) - 20,
              backgroundColor:
                paymentSystem === 'MasterCard'
                  ? theme.colors.mainDark
                  : theme.colors.white,
              height: 30,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 6,
              borderWidth: 1,
            }}
            onPress={() => setPaymentSystem('MasterCard')}
          >
            <components.Image
              source={{
                uri: 'https://george-fx.github.io/apitex/payment/02.png',
              }}
              style={{width: 26.35, height: 16}}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCards = () => {
    return (
      <ScrollView
        horizontal={true}
        contentContainerStyle={{
          paddingLeft: 20,
        }}
        style={{flexGrow: 0, marginBottom: theme.sizes.marginBottom_20}}
        showsHorizontalScrollIndicator={false}
      >
        {cards.map((item, index) => {
          return (
            <components.Image
              source={{uri: item}}
              key={index}
              style={{
                width: responsiveWidth(48),
                marginRight: 10,
                aspectRatio: 1.64,
              }}
              imageStyle={{borderRadius: responsiveHeight(1.2)}}
            />
          );
        })}
      </ScrollView>
    );
  };

  const renderDescription = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
          }}
        >
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
          dolore eu fugiat nulla pariatur.
        </Text>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: theme.sizes.marginTop_10,
        }}
      >
        {renderType()}
        {renderCurrency()}
        {renderPaymentSystem()}
        {renderCards()}
        {renderDescription()}
      </ScrollView>
    );
  };

  const renderButton = () => {
    return (
      <components.Button
        text='Open new card'
        containerStyle={{padding: 20}}
        title='Add new card'
        onPress={() => {
          navigation.navigate('CardMenu');
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

export default OpenNewCard;
