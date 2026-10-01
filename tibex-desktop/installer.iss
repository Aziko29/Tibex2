; Inno Setup skripti: avval build.bat ni ishga tushiring, keyin shu faylni Inno Setup'da oching
[Setup]
AppName=TIBEX
AppVersion=1.0
DefaultDirName={autopf}\TIBEX
DefaultGroupName=TIBEX
OutputBaseFilename=TIBEX-Setup
Compression=lzma
SolidCompression=yes
SetupIconFile=assets\tibex.ico

[Files]
Source: "dist\TIBEX\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{autodesktop}\TIBEX"; Filename: "{app}\TIBEX.exe"
Name: "{autodesktop}\TIBEX (to'liq ekran)"; Filename: "{app}\TIBEX.exe"; Parameters: "--kiosk"
Name: "{group}\TIBEX"; Filename: "{app}\TIBEX.exe"
