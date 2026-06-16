import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';
import {useNavigation} from '@react-navigation/native';
import Image from 'react-native-scalable-image';
import {
  responsiveHeight,
  responsiveWidth,
} from 'react-native-responsive-dimensions';

import {components} from '../../components';
import {theme} from '../../constants';
import {svg} from '../../assets/svg';

const operations = [
  {
    id: 1,
    title: 'Receive\nPayment',
    icon: require('../../assets/icons/credit-card.png'),
  },
  {
    id: 2,
    title: 'Money\nTransfer',
    icon: require('../../assets/icons/repeat.png'),
  },
  {
    id: 3,
    title: 'Make a \nPayment',
    icon: require('../../assets/icons/dollar2.png'),
  },
];

const cards = [
  {
    id: 1,
    image: 'https://george-fx.github.io/apitex/cards/01.jpg',
  },
  {
    id: 2,
    image: 'https://george-fx.github.io/apitex/cards/02.jpg',
  },
];

const persons = [
  {
    id: 1,
    image: 'https://george-fx.github.io/apitex/users/02.png',
    name: 'Jazmine C.',
  },
  {
    id: 2,
    image: 'https://george-fx.github.io/apitex/users/03.png',
    name: 'Bryan C.',
  },
  {
    id: 3,
    image: 'https://george-fx.github.io/apitex/users/04.png',
    name: 'Dalia H.',
  },
  {
    id: 4,
    image: 'https://george-fx.github.io/apitex/users/05.png',
    name: 'Marcus B.',
  },
  {
    id: 5,
    image: 'https://george-fx.github.io/apitex/users/06.png',
    name: 'Angel B.',
  },
];

const transactions = [
  {
    id: 1,
    paymentTo: 'Lucian Pennington',
    type: 'Money transfer',
    price: '+ 136.00',
    icon: require('../../assets/icons/dollar3.png'),
  },
  {
    id: 2,
    paymentTo: 'Electricity',
    type: 'Utility bills',
    price: '- 245.27',
    icon: require('../../assets/icons/electricity.png'),
  },
  {
    id: 3,
    paymentTo: 'Paypal',
    type: 'Deposits',
    price: '+ 500.00',
    icon: require('../../assets/icons/paypal.png'),
  },
];

const Dashboard = () => {
  const navigation = useNavigation();

  const renderCards = () => {
    return (
      <ScrollView
        horizontal={true}
        contentContainerStyle={{
          paddingLeft: 20,
        }}
        style={{
          flexGrow: 0,
          marginBottom: 16,
          marginTop: 20,
        }}
        showsHorizontalScrollIndicator={false}
      >
        {cards.map((item, index, array) => {
          const last = array.length - 1;
          const marginRight = index === last ? 20 : 16;

          return (
            <TouchableOpacity
              key={index}
              style={{
                marginRight: marginRight,
                borderRadius: 27,
              }}
              onPress={() => navigation.navigate('CardDetails')}
            >
              <components.Image
                source={{uri: item.image}}
                style={{
                  width: responsiveWidth(50),
                  aspectRatio: 8 / 5,
                }}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderOperations = () => {
    return (
      <ScrollView
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingLeft: 20,
        }}
        style={{flexGrow: 0, marginBottom: 30}}
      >
        {operations.map((item, index, array) => {
          const lastElement = array.length === index + 1;

          return (
            <TouchableOpacity
              key={index}
              style={{
                backgroundColor: theme.colors.mainDark,
                marginRight: lastElement ? 20 : 16,
                borderRadius: 10,
                padding: 11,
                paddingRight: 16,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              onPress={() => {
                if (item.title === 'Receive\nPayment') {
                  navigation.navigate('CreateInvoice');
                }
                if (item.title === 'Money\nTransfer') {
                  navigation.navigate('FundTransfer');
                }
                if (item.title === 'Make a \nPayment') {
                  navigation.navigate('Payments');
                }
              }}
            >
              <components.Image
                source={item.icon}
                style={{
                  width: responsiveWidth(7),
                  aspectRatio: 1 / 1,
                }}
              />
              <Text
                style={{
                  ...theme.fonts.SourceSansPro_Regular_10,
                  color: '#B4B4C6',
                  lineHeight:
                    theme.fonts.SourceSansPro_Regular_10.fontSize * 1.2,
                  marginLeft: 7,
                }}
                numberOfLines={2}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderTransfer = () => {
    return (
      <View style={{marginBottom: 30}}>
        <components.BlockHeading title='Quick money transfer to:' />
        <ScrollView
          horizontal={true}
          contentContainerStyle={{paddingLeft: 20}}
          showsHorizontalScrollIndicator={false}
        >
          {persons.map((item, index, array) => {
            return (
              <TouchableOpacity
                key={index}
                style={{
                  marginRight: 11,
                  width: 55,
                }}
                onPress={() => navigation.navigate('FundTransfer')}
              >
                <components.Image
                  source={{uri: item.image}}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignSelf: 'center',
                    marginBottom: 4,
                  }}
                />
                <Text
                  style={{
                    textAlign: 'center',
                    ...theme.fonts.SourceSansPro_Regular_12,
                    lineHeight:
                      theme.fonts.SourceSansPro_Regular_12.fontSize * 1.2,
                    color: theme.colors.bodyTextColor,
                  }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={{
              marginRight: 20,
              width: 55,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                backgroundColor: '#FFD9C3',
                borderRadius: 20,
                alignSelf: 'center',
                marginBottom: 4,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <svg.PlusSvg />
            </View>
            <Text
              style={{
                ...theme.fonts.SourceSansPro_Regular_12,
                lineHeight: theme.fonts.SourceSansPro_Regular_12.fontSize * 1.2,
                textAlign: 'center',
                color: theme.colors.bodyTextColor,
              }}
              numberOfLines={1}
            >
              Choose
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  const renderTransactions = () => {
    return (
      <ScrollView
        contentContainerStyle={{flexGrow: 1}}
        style={{
          flexGrow: 0,
          marginBottom: 30,
        }}
      >
        <components.BlockHeading
          title='Latest transactions'
          icon={<svg.BlockSearchSvg />}
        />
        <View style={{paddingHorizontal: 20}}>
          {transactions.map((item, index, array) => {
            const last = array.length === index + 1;

            return (
              <TouchableOpacity
                key={index}
                style={{
                  width: '100%',
                  backgroundColor: '#FFF7F2',
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: last ? 0 : 6,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                onPress={() => navigation.navigate('TransactionDetails')}
              >
                <Image width={responsiveWidth(7)} source={item.icon} />
                <View style={{marginLeft: 14, marginRight: 'auto'}}>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.mainDark,
                      textTransform: 'capitalize',
                    }}
                    numberOfLines={1}
                  >
                    {item.paymentTo}
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_12,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_12.fontSize * 1.6,
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    {item.type}
                  </Text>
                </View>
                <Text
                  style={{
                    ...theme.fonts.SourceSansPro_Regular_14,
                    lineHeight:
                      theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
                    color:
                      item.type === 'Money transfer' || item.type === 'Deposits'
                        ? '#55ACEE'
                        : theme.colors.mainDark,
                  }}
                >
                  {item.price}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView contentContainerStyle={{flexGrow: 1}}>
        {renderCards()}
        {renderOperations()}
        {renderTransfer()}
        {renderTransactions()}
      </ScrollView>
    );
  };

  return <View style={{flex: 1}}>{renderContent()}</View>;
};

export default Dashboard;
