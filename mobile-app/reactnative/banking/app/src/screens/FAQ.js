import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React, {useState} from 'react';
import Accordion from 'react-native-collapsible/Accordion';

import {components} from '../components';
import {theme} from '../constants';
import {svg} from '../assets/svg';

const frequentlyQuestions = [
  {
    id: '1',
    question: "What's included with a free plan ?",
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
  {
    id: '2',
    question: 'What content will my app have ?',
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
  {
    id: '3',
    question: 'Can I change my icon ?',
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
  {
    id: '4',
    question: 'What is a hybrid app ?',
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
  {
    id: '5',
    question: 'How do Push Alerts work ?',
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
  {
    id: '6',
    question: 'Why can’t the app upload files ?',
    answer:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  },
];

const FAQ = () => {
  const [activeSections, setActiveSections] = useState([]);

  const setSections = (sections) => {
    setActiveSections(sections.includes(undefined) ? [] : sections);
  };

  const renderHeader = () => {
    return <components.Header title='FAQ' goBack={true} />;
  };

  const renderFaqHeader = (section, _, isActive) => {
    return (
      <View
        style={{
          paddingVertical: theme.sizes.paddingVertical_15,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#FFF7F2',
          borderRadius: 10,
          paddingHorizontal: 20,
          marginBottom: theme.sizes.marginBottom_10,
          borderWidth: 1,
          borderColor: isActive ? theme.colors.mainColor : '#FFF7F2',
        }}
      >
        <Text
          style={{
            ...theme.fonts.SourceSansPro_Regular_16,
            lineHeight: theme.fonts.SourceSansPro_Regular_16.fontSize * 1.3,
            textTransform: 'capitalize',
            color: theme.colors.mainDark,
          }}
        >
          {section.question}
        </Text>
        {isActive ? <svg.ArrowCloseSvg /> : <svg.ArrowOpenSvg />}
      </View>
    );
  };

  const renderFaqContent = (section, _, isActive) => {
    return (
      <View
        style={{
          paddingLeft: 18,
          borderLeftWidth: 1,
          borderLeftColor: theme.colors.mainColor,
          marginTop: theme.sizes.marginTop_20,
          marginBottom: theme.sizes.marginBottom_30,
        }}
      >
        <View>
          <Text
            style={{
              ...theme.fonts.SourceSansPro_Regular_16,
              color: theme.colors.bodyTextColor,
            }}
          >
            {section.answer}
          </Text>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: theme.sizes.marginTop_10,
          backgroundColor: theme.colors.white,
        }}
      >
        <Accordion
          activeSections={activeSections}
          sections={frequentlyQuestions}
          touchableComponent={TouchableOpacity}
          renderHeader={renderFaqHeader}
          renderContent={renderFaqContent}
          duration={400}
          onChange={setSections}
          sectionContainerStyle={{
            marginHorizontal: 20,
          }}
        />
      </ScrollView>
    );
  };

  return (
    <components.SafeAreaView>
      {renderHeader()}
      {renderContent()}
    </components.SafeAreaView>
  );
};

export default FAQ;
