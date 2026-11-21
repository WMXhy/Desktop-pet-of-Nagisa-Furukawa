Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Name "古河渚桌宠"
OutFile "${SETUP_EXE}"
InstallDir "$LOCALAPPDATA\Programs\Nagisa Desktop Pet"
InstallDirRegKey HKCU "Software\WMXhy\NagisaDesktopPet" "InstallDir"
; Pass roots to our validator so NSIS cannot silently substitute the default directory.
AllowRootDirInstall true
CRCCheck force
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "Nagisa Desktop Pet"
VIAddVersionKey /LANG=2052 "FileDescription" "古河渚桌宠 Windows x64 安装程序"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "WMXhy"
VIAddVersionKey /LANG=2052 "LegalCopyright" "WMXhy"

Var DirectoryText
Var Result
Var Message

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_DIRECTORYPAGE_TEXT_TOP "$DirectoryText"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装位置"
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE
!define MUI_PAGE_HEADER_TEXT "选择安装位置"
!define MUI_PAGE_HEADER_SUBTEXT "选择保存古河渚桌宠程序的文件夹。"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateSelection
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nagisa Desktop Pet.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动古河渚桌宠"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
    SetShellVarContext current
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=NagisaInstaller.exe "${INSTALL_ENGINE}"
    nsExec::Exec '"$PLUGINSDIR\NagisaInstaller.exe" info "$PLUGINSDIR\result.ini"'
    Pop $Result
    ${If} $Result != 0
        ReadINIStr $Message "$PLUGINSDIR\result.ini" "Result" "message"
        MessageBox MB_ICONSTOP|MB_OK "$Message" /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}

    StrCpy $DirectoryText "这里保存桌宠程序。已有养成进度会从当前 Windows 账户继续读取。"
    ReadINIStr $0 "$PLUGINSDIR\result.ini" "Result" "directory"
    ReadINIStr $1 "$PLUGINSDIR\result.ini" "Result" "legacy"
    ${If} $0 != ""
        StrCpy $DirectoryText "已安装在 $0。将升级已安装的桌宠，保留你的存档。"
        IfSilent +2
        StrCpy $INSTDIR $0
    ${ElseIf} $1 != ""
        StrCpy $DirectoryText "旧版安装在 $1。将升级已安装的桌宠，保留你的存档。"
    ${EndIf}
    SectionSetSize 0 ${PAYLOAD_KIB}
FunctionEnd

Function ValidateSelection
    nsExec::Exec '"$PLUGINSDIR\NagisaInstaller.exe" validate "$INSTDIR\." ${PAYLOAD_BYTES} "$PLUGINSDIR\result.ini"'
    Pop $Result
    ${If} $Result != 0
        ReadINIStr $Message "$PLUGINSDIR\result.ini" "Result" "message"
        MessageBox MB_ICONEXCLAMATION|MB_OK "$Message" /SD IDOK
        Abort
    ${EndIf}
    ReadINIStr $0 "$PLUGINSDIR\result.ini" "Result" "directory"
    ${If} $0 != $INSTDIR
        StrCpy $INSTDIR $0
        SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
        Abort
    ${EndIf}
FunctionEnd

Section "安装桌宠"
    DetailPrint "正在准备程序文件…"
    nsExec::Exec '"$PLUGINSDIR\NagisaInstaller.exe" validate "$INSTDIR\." ${PAYLOAD_BYTES} "$PLUGINSDIR\result.ini"'
    Pop $Result
    ${If} $Result != 0
        ReadINIStr $Message "$PLUGINSDIR\result.ini" "Result" "message"
        Goto failure
    ${EndIf}
    ReadINIStr $INSTDIR "$PLUGINSDIR\result.ini" "Result" "directory"
    ClearErrors
    SetOutPath "$PLUGINSDIR\payload"
    File /r "${PAYLOAD_DIR}\*"
    CopyFiles /SILENT "$PLUGINSDIR\NagisaInstaller.exe" "$PLUGINSDIR\payload"
    WriteUninstaller "$PLUGINSDIR\payload\Uninstall.exe"
    ${If} ${Errors}
        StrCpy $Message "无法展开安装文件。请检查临时磁盘的空间，再运行 Setup 重试。"
        Goto failure
    ${EndIf}
    DetailPrint "正在校验程序并更新 Windows 入口…"
    nsExec::Exec '"$PLUGINSDIR\NagisaInstaller.exe" install "$INSTDIR\." "$PLUGINSDIR\payload" "${APP_VERSION}" ${PAYLOAD_BYTES} "$PLUGINSDIR\result.ini"'
    Pop $Result
    ${If} $Result == 0
        ReadINIStr $INSTDIR "$PLUGINSDIR\result.ini" "Result" "directory"
        SetOutPath "$INSTDIR"
        Goto success
    ${EndIf}
    ReadINIStr $Message "$PLUGINSDIR\result.ini" "Result" "message"
    failure:
        SetErrorLevel 1
        DetailPrint "$Message"
        MessageBox MB_ICONSTOP|MB_OK "$Message" /SD IDOK
        Abort
    success:
SectionEnd

Section "Uninstall"
    SetShellVarContext current
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    CopyFiles /SILENT "$INSTDIR\NagisaInstaller.exe" "$PLUGINSDIR"
    nsExec::Exec '"$PLUGINSDIR\NagisaInstaller.exe" uninstall "$INSTDIR\." "$PLUGINSDIR\result.ini"'
    Pop $Result
    ${If} $Result != 0
        ReadINIStr $Message "$PLUGINSDIR\result.ini" "Result" "message"
        DetailPrint "$Message"
        MessageBox MB_ICONSTOP|MB_OK "$Message" /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
SectionEnd
