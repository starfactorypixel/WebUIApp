@ECHO OFF

ECHO.
ECHO ^> Check updates...
call npm install serialport ws

ECHO.
ECHO ^> Run server...
node server.js
