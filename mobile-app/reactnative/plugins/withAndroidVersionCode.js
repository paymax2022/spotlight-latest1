const { withAppBuildGradle } = require('expo/config-plugins');

const VERSION_CODE_MARKER = '// withAndroidVersionCode:';

const VERSION_CODE_BLOCK = `
${VERSION_CODE_MARKER}
def androidVersionCodeState = rootProject.file("../android-version-code")
def lastAndroidVersionCode = androidVersionCodeState.exists()
    ? androidVersionCodeState.text.trim().toInteger()
    : 1
def nextAndroidVersionCode = lastAndroidVersionCode + 1

android {
    defaultConfig {
        versionCode nextAndroidVersionCode
    }
}

tasks.configureEach { task ->
    if (task.name in ["assembleRelease", "bundleRelease"]) {
        task.doLast {
            androidVersionCodeState.text = nextAndroidVersionCode.toString() + "\\n"
            println "withAndroidVersionCode: recorded release versionCode " + nextAndroidVersionCode
        }
    }
}
`;

module.exports = function withAndroidVersionCode(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    const existingBlockIndex = config.modResults.contents.indexOf(VERSION_CODE_MARKER);
    if (existingBlockIndex !== -1) {
      config.modResults.contents =
        config.modResults.contents.slice(0, existingBlockIndex).trimEnd() +
        '\n' +
        VERSION_CODE_BLOCK.trim() +
        '\n';
    } else {
      config.modResults.contents += VERSION_CODE_BLOCK;
    }
    return config;
  });
};
