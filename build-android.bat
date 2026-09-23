@echo off
set JAVA_HOME=C:\Progra~1\Java\jdk-17
set ANDROID_HOME=C:\Users\iamas\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd C:\Projects\ProofQuest\mobile\android
call gradlew.bat app:installDebug -PreactNativeDevServerPort=8081
