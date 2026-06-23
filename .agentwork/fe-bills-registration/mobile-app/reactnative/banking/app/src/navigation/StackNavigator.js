import React from 'react';
import {View, Text} from 'react-native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

import {screens} from '../screens';

import TabNavigator from './TabNavigator';

const StackNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name='Onboarding'
        component={screens.Onboarding}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='SignUp'
        component={screens.SignUp}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='VerifyYourPhoneNumber'
        component={screens.VerifyYourPhoneNumber}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='SignIn'
        component={screens.SignIn}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='TabNavigator'
        component={TabNavigator}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='OpenDeposit'
        component={screens.OpenDeposit}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='OpenMoneybox'
        component={screens.OpenMoneybox}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='Profile'
        component={screens.Profile}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='EditPersonalInfo'
        component={screens.EditPersonalInfo}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='OpenNewCard'
        component={screens.OpenNewCard}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='CreateInvoice'
        component={screens.CreateInvoice}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='InvoiceSent'
        component={screens.InvoiceSent}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='Statistics'
        component={screens.Statistics}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='FAQ'
        component={screens.FAQ}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='PrivacyPolicy'
        component={screens.PrivacyPolicy}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='CardMenu'
        component={screens.CardMenu}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='CardDetails'
        component={screens.CardDetails}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='ChangePinCode'
        component={screens.ChangePinCode}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='Payments'
        component={screens.Payments}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='MobilePayment'
        component={screens.MobilePayment}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='FundTransfer'
        component={screens.FundTransfer}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='IBANPayment'
        component={screens.IBANPayment}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='TransactionDetails'
        component={screens.TransactionDetails}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='PaymentSuccess'
        component={screens.PaymentSuccess}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='PaymentFailed'
        component={screens.PaymentFailed}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='SignUpAccountCreated'
        component={screens.SignUpAccountCreated}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='SignInCode'
        component={screens.SignInCode}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='ForgotPassword'
        component={screens.ForgotPassword}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='NewPassword'
        component={screens.NewPassword}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='ForgotPasswordSentEmail'
        component={screens.ForgotPasswordSentEmail}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='ConfirmationCode'
        component={screens.ConfirmationCode}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='ExchangeRates'
        component={screens.ExchangeRates}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='OpenNewLoan'
        component={screens.OpenNewLoan}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name='TopUpPayment'
        component={screens.TopUpPayment}
        options={{headerShown: false}}
      />
    </Stack.Navigator>
  );
};

export default StackNavigator;
