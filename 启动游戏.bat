@echo off
chcp 65001 >nul
title 云游山河 - 心脏康复集章之旅
cd /d "%~dp0"
echo ============================================
echo   云游山河 · 心脏康复集章之旅
echo   正在启动本地服务器（请勿关闭本窗口）
echo ============================================
echo.
where py >nul 2>nul && (set "PYCMD=py -3") || (set "PYCMD=python")
start "" http://localhost:8616
%PYCMD% -m http.server 8616
pause
