@echo off
set JAVA_HOME=C:\Progra~1\Java\jdk-17
set ANDROID_HOME=C:\Users\iamas\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd C:\Projects\ProofQuest\mobile\android
call gradlew.bat app:assembleRelease > C:\Projects\ProofQuest\logs.txt 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo BUILD FAILED - check logs.txt
    type C:\Projects\ProofQuest\logs.txt | findstr /i "error\|FAILED\|Exception"
    exit /b 1
)
echo BUILD SUCCEEDED
echo Installing release APK...
adb install -r app\build\outputs\apk\release\app-release.apk
