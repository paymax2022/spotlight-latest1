import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';
import ParsedText from 'react-native-parsed-text';
import {useNavigation} from '@react-navigation/native';

import {theme} from '../../constants';
import {svg} from '../../assets/svg';

const loans = [
  {
    id: 1,
    minusBalance: '- 20 532.00',
    rate: '13 %',
    period: '24 months',
    monthlyPayment: '1117.00',
    totalPaid: '4468.00',
    currency: 'USD',
  },
];

const Loans = () => {
  const navigation = useNavigation();

  const renderHeader = () => {
    return (
      <View style={{paddingHorizontal: 20}}>
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_28,
            lineHeight: theme.fonts.SourceSansPro_Regular_28.fontSize * 1.2,
            marginBottom: theme.sizes.marginTop_20,
            color: theme.colors.mainDark,
            marginTop: theme.sizes.marginBottom_40,
          }}
        >
          Loans
        </Text>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
        }}
      >
        <Text
          style={{
            marginBottom: theme.sizes.marginBottom_12,
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
            color: theme.colors.bodyTextColor,
          }}
        >
          Current loans
        </Text>
        {loans.map((loan, index) => {
          return (
            <View key={index}>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#FFF7F2',
                  borderRadius: 10,
                  padding: 20,
                  marginBottom: 20,
                }}
              >
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <View
                    style={{
                      marginRight: 8,
                    }}
                  >
                    <svg.PercentageLoanSvg />
                  </View>
                  <ParsedText
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_16,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
                      color: theme.colors.mainDark,
                    }}
                    parse={[
                      {
                        pattern: /00 USD/,
                        style: {...theme.fonts.SourceSansPro_Regular_14},
                      },
                    ]}
                  >
                    {loan.minusBalance + ' ' + loan.currency}
                  </ParsedText>
                </View>
                <Text
                  style={{
                    ...theme.fonts.SourceSansPro_SemiBold_14,
                    color: theme.colors.mainColor,
                  }}
                >
                  Repay →
                </Text>
              </TouchableOpacity>
              <View style={{paddingHorizontal: 20}}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: theme.sizes.marginBottom_14,
                  }}
                >
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      textTransform: 'capitalize',
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    rate
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.mainDark,
                    }}
                  >
                    {loan.rate}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      textTransform: 'capitalize',
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    Period
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.mainDark,
                    }}
                  >
                    {loan.period}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      textTransform: 'capitalize',
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    Monthly payment
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.mainDark,
                    }}
                  >
                    {loan.monthlyPayment} USD
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      textTransform: 'capitalize',
                      color: theme.colors.bodyTextColor,
                    }}
                  >
                    Total paid
                  </Text>
                  <Text
                    style={{
                      ...theme.fonts.SourceSansPro_Regular_14,
                      lineHeight:
                        theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
                      color: theme.colors.mainDark,
                    }}
                  >
                    {loan.totalPaid} USD
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderFooter = () => {
    return (
      <View style={{padding: 20}}>
        <TouchableOpacity
          style={{
            height: 40,
            width: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#FFD9C3',
            borderRadius: 10,
          }}
          onPress={() => navigation.navigate('OpenNewLoan')}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_SemiBold_16,
              color: theme.colors.mainDark,
            }}
          >
            + New Loan
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

export default Loans;
