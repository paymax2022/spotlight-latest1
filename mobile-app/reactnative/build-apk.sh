#!/bin/bash
set -e

# React Native APK Build Script
# Sets up Java environment and builds release APK

JAVA_HOME=/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME

cd "$(dirname "$0")"

echo "🔨 Building React Native APK..."
echo "JAVA_HOME: $JAVA_HOME"
echo ""

cd android

./gradlew clean assembleRelease

echo ""
echo "✅ Build complete!"
echo "APK location:"
find app/build/outputs/apk -name "*.apk" -type f

