import {View, Text, StatusBar, ScrollView} from 'react-native';
import React from 'react';
import {
  responsiveHeight,
  responsiveWidth,
  responsiveFontSize,
} from 'react-native-responsive-dimensions';
import FitImage from 'react-native-fit-image';
import ParsedText from 'react-native-parsed-text';

import {components} from '../components';
import {theme} from '../constants';

const details = {
  id: 1,
  sentTo: 'Hillary Holmes',
  card: '**** 1234',
  amount: '263.57 USD',
  fee: '1.8 USD',
  residualBalance: '4 863.27 USD',
};

const TransactionDetails = () => {
  const renderHeader = () => {
    return <components.Header goBack={true} />;
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: theme.sizes.paddingTop_10,
          paddingBottom: theme.sizes.paddingBottom_20,
        }}
      >
        <ParsedText
          style={{
            ...theme.fonts.SourceSansPro_Regular_40,
            color: theme.colors.mainDark,
            textAlign: 'center',
            marginBottom: theme.sizes.marginBottom_10,
          }}
          parse={[
            {
              pattern: /57 USD/,
              style: {
                ...theme.fonts.SourceSansPro_Regular_16,
                color: theme.colors.mainDark,
              },
            },
          ]}
        >
          - 263.57 USD
        </ParsedText>
        <Text
          style={{
            color: '#B4B4C6',
            textAlign: 'center',
            ...theme.fonts.SourceSansPro_Regular_14,
            lineHeight: theme.fonts.SourceSansPro_Regular_14.fontSize * 1.6,
            marginBottom: theme.sizes.marginBottom_20,
          }}
        >
          Apr 10, 2023 at 11:34 AM
        </Text>
        <components.Image
          source={require('../assets/icons/check.png')}
          style={{
            width: responsiveHeight(8),
            aspectRatio: 1 / 1,
            alignSelf: 'center',
            marginBottom: theme.sizes.marginBottom_25,
          }}
        />
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: responsiveHeight(2),
          }}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
              color: theme.colors.bodyTextColor,
            }}
          >
            Sent to
          </Text>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
            }}
          >
            Hillary Holmes
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: responsiveHeight(2),
          }}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
              color: theme.colors.bodyTextColor,
            }}
          >
            Card
          </Text>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
            }}
          >
            **** 4253
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: responsiveHeight(2),
          }}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
              color: theme.colors.bodyTextColor,
            }}
          >
            Amount
          </Text>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
            }}
          >
            263.57 USD
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: responsiveHeight(2),
          }}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
              color: theme.colors.bodyTextColor,
            }}
          >
            Fee
          </Text>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
            }}
          >
            1.8 USD
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: responsiveHeight(2),
          }}
        >
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.6,
              color: theme.colors.bodyTextColor,
            }}
          >
            Residual balance
          </Text>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
              color: theme.colors.mainDark,
            }}
          >
            4 863.27 USD
          </Text>
        </View>
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
        <components.Button
          title='repeat transfer'
          containerStyle={{
            width: responsiveWidth(42),
          }}
          lightShade={true}
        />
        <components.Button
          title='Download PDF'
          containerStyle={{
            width: responsiveWidth(42),
          }}
        />
      </View>
    );
  };

  return (
    <components.SafeAreaView>
      {renderHeader()}
      {renderContent()}
      {renderFooter()}
    </components.SafeAreaView>
  );
};

export default TransactionDetails;
