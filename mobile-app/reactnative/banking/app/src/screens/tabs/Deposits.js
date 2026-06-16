import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';
import {useNavigation} from '@react-navigation/native';
import ParsedText from 'react-native-parsed-text';

import {theme} from '../../constants';
import {svg} from '../../assets/svg';

const currentDeposits = [
  {
    id: 1,
    type: 'Withdrawal →',
    amount: 1712.78,
    date: 'Jan 1 - Apr 1, 2023',
    status: 'completed',
    currency: 'USD',
  },
  {
    id: 2,
    type: 'Top - up  →',
    amount: 3648.37,
    date: 'Jan 1 - Apr 1, 2023',
    status: 'processing',
    currency: 'USD',
  },
];

const currentMoneyboxes = [
  {
    id: 1,
    amount: 650.37,
    moneybox: 'New iPhone Pro Max',
    goal: 1200,
    currency: 'USD',
  },
];

const Deposits = () => {
  const navigation = useNavigation();

  const renderHeader = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_SemiBold_28,
            lineHeight: theme.fonts.SourceSansPro_Regular_28.fontSize * 1.2,
            marginBottom: theme.sizes.marginBottom_20,
            color: theme.colors.mainDark,
            marginTop: theme.sizes.marginBottom_40,
          }}
        >
          Deposits
        </Text>
      </View>
    );
  };

  const renderMoneyboxes = () => {
    return (
      <View>
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_10,
            ...theme.fonts.SourceSansPro_Regular_14,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
          }}
        >
          Current moneyboxes
        </Text>
        {currentMoneyboxes.map((item, index, array) => {
          const last = array.length === index + 1;

          return (
            <TouchableOpacity
              key={index}
              style={{
                width: '100%',
                paddingVertical: 17,
                paddingHorizontal: 14,
                backgroundColor: '#FFF7F2',
                borderRadius: 10,
                marginBottom: last ? 0 : 6,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View style={{marginRight: 8}}>
                <svg.PiggyBankSvg />
              </View>
              <View style={{flex: 1}}>
                <ParsedText
                  style={{
                    ...theme.fonts.SourceSansPro_Regular_20,
                    color: theme.colors.mainDark,
                  }}
                  parse={[
                    {
                      pattern: /USD/,
                      style: {
                        color: theme.colors.mainDark,
                        ...theme.fonts.SourceSansPro_Regular_14,
                      },
                    },
                  ]}
                >
                  {item.amount + ' ' + item.currency}
                </ParsedText>
                <View
                  style={{
                    width: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.bodyTextColor,
                    }}
                    numberOfLines={1}
                  >
                    {item.moneybox}
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    Goal: ${item.goal}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderDeposits = () => {
    return (
      <View style={{marginBottom: theme.sizes.marginBottom_30}}>
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_10,
            ...theme.fonts.SourceSansPro_Regular_14,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
          }}
        >
          Current deposits
        </Text>
        {currentDeposits.map((item, index, array) => {
          const last = array.length === index + 1;

          return (
            <TouchableOpacity
              key={index}
              style={{
                width: '100%',
                paddingVertical: 17,
                paddingHorizontal: 14,
                backgroundColor: '#FFF7F2',
                borderRadius: 10,
                marginBottom: last ? 0 : 6,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              {item.status === 'completed' && (
                <View style={{marginRight: 8}}>
                  <svg.CompletedSvg />
                </View>
              )}
              {item.status === 'processing' && (
                <View style={{marginRight: 8}}>
                  <svg.ProcessingSvg />
                </View>
              )}
              <View style={{marginRight: 'auto'}}>
                <ParsedText
                  style={{
                    ...theme.fonts.SourceSansPro_Regular_20,
                    color: theme.colors.mainDark,
                  }}
                  parse={[
                    {
                      pattern: /USD/,
                      style: {
                        color: theme.colors.mainDark,
                        ...theme.fonts.SourceSansPro_Regular_14,
                      },
                    },
                  ]}
                >
                  {item.amount + ' ' + item.currency}
                </ParsedText>
                <Text
                  style={{
                    ...theme.fonts.SourceSansPro_Regular_14,
                    lineHeight:
                      theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                    color: theme.colors.bodyTextColor,
                  }}
                  numberOfLines={1}
                >
                  {item.date}
                </Text>
              </View>
              <Text
                style={{
                  ...theme.fonts.SourceSansPro_SemiBold_14,
                  color: theme.colors.mainColor,
                }}
              >
                {item.type}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView contentContainerStyle={{flexGrow: 1, paddingHorizontal: 20}}>
        {renderDeposits()}
        {renderMoneyboxes()}
      </ScrollView>
    );
  };

  const renderFooter = () => {
    return (
      <View
        style={{
          padding: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TouchableOpacity
          style={{
            backgroundColor: '#FFD9C3',
            width: '48%',
            height: 40,
            borderRadius: 10,
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => navigation.navigate('OpenMoneybox')}
        >
          <Text
            style={{
              color: theme.colors.mainDark,
              ...theme.fonts.SourceSansPro_SemiBold_16,
              textTransform: 'capitalize',
            }}
          >
            + moneybox
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            backgroundColor: theme.colors.mainDark,
            width: '48%',
            height: 40,
            borderRadius: 10,
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => navigation.navigate('OpenDeposit')}
        >
          <Text
            style={{
              color: theme.colors.white,
              ...theme.fonts.SourceSansPro_SemiBold_16,
              textTransform: 'capitalize',
            }}
          >
            + Deposit
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{flex: 1}}>
      {renderHeader()}
      {renderContent()}
      {renderFooter()}
    </View>
  );
};

export default Deposits;
