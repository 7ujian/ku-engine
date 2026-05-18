@echo off
set DIR=%~dp0
node "%DIR%runtime\dist\player\main.js" "%DIR%game" %*
