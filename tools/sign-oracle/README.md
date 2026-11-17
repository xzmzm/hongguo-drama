# USB 手机签名 Oracle

此目录提供 `com.sign.oracle` Android 辅助程序的脱敏包装源码，供桌面应用的可选 `usb_signer` 桥接使用。默认桌面播放不依赖它。已安装的官方海外版应用提供 SDK Java 类；匹配的 arm64 原生库和 SDK 配置由使用者在本机提供。本仓库不分发这些 SDK 输入或签名密钥。

## 构建环境

- JDK 17 或更新版本，`javac` 可从 `JAVA_HOME` 或 PATH 找到。
- Android SDK Platform 36、Build Tools 36.0.0、platform-tools（adb）。通过 `ANDROID_SDK_ROOT` 或 `ANDROID_HOME` 指向自己的 SDK 安装目录。
- Windows PowerShell 5.1 或 PowerShell 7。脚本也支持显式 `-SdkRoot`、`-JavaHome`、`-BuildToolsVersion` 参数；不要把自己的绝对路径提交到仓库。
- 使用时需要 arm64 Android 8.0/API 26 或更新手机、已安装的 `com.phoenix.read.oversea.gp` 官方应用，以及已授权的 USB 调试。SDK 版本必须与本机输入相匹配；不保证其他版本兼容。

先从仓库根目录执行无需手机、配置或 SDK 原生库的检查：

```powershell
node tools/sign-oracle/test.cjs
& ./tools/sign-oracle/build.ps1 -SourcesOnly
```

第一个命令检查 URL、身份绑定、签名头过滤和请求长度限制；第二个编译全部 Android Java、生成 DEX 并链接 Manifest，不生成可安装的完整助手。

## 本机输入和完整 APK

创建 `tools/sign-oracle/.local/inputs`，将示例复制为其中的 `oracle-config.json`，填入与官方应用匹配、自己有权使用的 SDK 参数：

```powershell
New-Item -ItemType Directory -Force tools/sign-oracle/.local/inputs | Out-Null
Copy-Item tools/sign-oracle/oracle-config.example.json tools/sign-oracle/.local/inputs/oracle-config.json
```

配置只接受 `target_package`、`app_id`、`license`、`setting_config`、`channel` 五个字符串字段。`app_id` 是 SDK 应用编号，不是设备身份。许可证和不透明配置只在本机填写；示例故意留空。不要加入 Android ID、设备序列号、`did`、`iid`、账号或令牌。将匹配的 `libmetasec_ml.so` 放入同一个输入目录；脚本检查其为 arm64 ELF。配置支持的目标仍以 Manifest 中声明可见的官方包为准。

```powershell
& ./tools/sign-oracle/build.ps1
```

默认输出未签名 APK。每次输出到 `.local/builds` 下的新目录，返回 APK 路径和 SHA256；脚本不清理旧文件、不安装应用。自定义输入或输出目录也应留在忽略目录或仓库之外。完整 APK 的 assets 包含本机 SDK 配置，不要上传该 APK 或构建中间产物。

安装前必须用自己的本机 keystore 签名。可交互创建本机密钥（密码由 keytool 提示输入）：

```powershell
keytool -genkeypair -keystore tools/sign-oracle/.local/oracle.keystore -alias oracle -keyalg RSA -keysize 2048 -validity 3650
```

按提示填写自己的证书信息。构建脚本从当前进程的 `SIGN_ORACLE_STORE_PASSWORD` 环境变量读取 keystore 密码，可选 `SIGN_ORACLE_KEY_PASSWORD` 设置独立密钥密码；通过本机密码管理方式注入，不写进脚本、文档或命令历史。准备好后：

```powershell
& ./tools/sign-oracle/build.ps1 -Keystore tools/sign-oracle/.local/oracle.keystore -KeyAlias oracle
```

脚本先对齐，再签名并检查签名和对齐；可用返回的 `Apk` 字段安装。首次安装使用新密钥即可，覆盖已有助手必须使用原有密钥。密钥不匹配时不要卸载旧应用来绕过问题，应保留旧安装并确认迁移方案。[Android 官方签名工具说明](https://developer.android.com/tools/apksigner)和 [AAPT2 说明](https://developer.android.com/tools/aapt2)介绍了这些构建步骤。

## 运行

确认只连接一台已授权的 USB 实机后，使用构建返回的 APK 路径在本机执行 `adb install -r`。打开 SignOracle 并点击启动，或运行：

```powershell
adb shell am start-foreground-service -n com.sign.oracle/.SignService
adb forward tcp:8762 tcp:8762
```

再开启桌面应用「设置 → 播放与缓存 → USB 手机签名」。桌面也能启动已安装服务并建立转发；它不会自动构建或安装助手。完成后可在助手内停止服务，并按需用 `adb forward --remove tcp:8762` 移除该转发。不要用批量停止或移除命令影响其他设备和服务。

服务只绑定手机 `127.0.0.1:8762`，每个连接一行 JSON。`{"op":"ping"}` 返回就绪状态；签名请求含 `url`、可选 `body_b64`（实际 gzip 正文的 Base64）、`did` 和 `iid`，成功返回 `headers`。身份必须与 URL 中相应 query 一致，且只用于当前请求；没有硬编码或读取手机 Android ID、序列号的逻辑。只允许指定官方 HTTPS 主机和播放模型路径，响应仅返回白名单签名头，错误内容固定。输入保持原样签名，不重建 URL 或正文。

服务不保存请求、签名或身份，不输出这些内容到日志。端口没有额外认证，同机其他应用也可能连接 loopback；只在需要时启用，并保持 adb 转发仅供本机使用。原生 SDK 自身的内部行为不在包装层控制范围内。

## 提交和验证边界

`.gitignore` 排除 `.local`、本机配置、APK、DEX、类文件、原生库、keystore 和密钥文件。提交前仍需检查实际暂存内容，不能只依赖文件名规则。此目录不包含个人设备身份、SDK 许可证值、私钥、二进制 SDK 或开发机绝对路径。

脱敏包装层经过主机协议检查和 Android 编译／打包验证；这不代表新 APK 已安装或真机签名、真实播放通过。此前桌面桥接的实测与限制见[开发记录](../../docs/usb-signer-2026-11-16.md)。本工具不改变任何正式版本或发布包。
