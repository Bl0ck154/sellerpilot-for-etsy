@echo off
REM ============================================
REM Cross-Browser Extension Build Script v2.0
REM Single manifest source with automatic Firefox patching
REM ============================================

echo.
echo ========================================
echo   Building Etsy AI Assistant
echo   Version: 1.6.6
echo ========================================
echo.

REM ============================================
REM Clean previous builds
REM ============================================

echo [1/4] Cleaning previous builds...
if exist "dist\chrome" rmdir /s /q "dist\chrome" >nul 2>&1
if exist "dist\firefox" rmdir /s /q "dist\firefox" >nul 2>&1

mkdir "dist\chrome" >nul 2>&1
mkdir "dist\firefox" >nul 2>&1

echo      Done!
echo.

REM ============================================
REM Build Chrome version
REM ============================================

echo [2/4] Building Chrome version...

REM Copy all source files including manifest
xcopy /s /e /y /q "src\*" "dist\chrome\" >nul

echo      Chrome build: dist\chrome\
echo.

REM ============================================
REM Build Firefox version with auto-patching
REM ============================================

echo [3/4] Building Firefox version...

REM Copy all source files
xcopy /s /e /y /q "src\*" "dist\firefox\" >nul

REM Generate Firefox manifest using PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -File "build-firefox-manifest.ps1"

echo      Firefox build: dist\firefox\
echo      - Removed 'offscreen' permission
echo      - Changed to scripts array
echo      - Added gecko settings
echo.

REM ============================================
REM Cleanup info
REM ============================================

echo [4/4] Information...
echo      OLD: manifests/ folder (deprecated)
echo      NEW: src\manifest.json (EDIT THIS!)
echo.

REM ============================================
REM Success
REM ============================================

echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo SOURCE:  src\manifest.json (EDIT THIS ONE!)
echo Chrome/Edge: dist\chrome\
echo Firefox: dist\firefox\
echo.
echo Tip: Any changes to src\manifest.json
echo      will auto-apply to both browsers!
echo.
if not defined CI pause
