# mx-puppet-qq

将 QQ 会话桥接到 Matrix 服务器，通过虚拟用户（Puppeting）提供类似第三方客户端的体验。

## 功能实现

### 基本功能

- [X] 私聊文字消息
  - [ ] 支持黄豆表情
  - [ ] 支持消息引用
- [X] 群聊文字消息
- [X] 图片收发
- [X] 文件收发
- [ ] 语音收发
- [ ] 转发在线状态
- [ ] 转发“正在输入”状态
- [ ] 转发撤回事件
  - [X] QQ 方可以撤回
  - [ ] 我可以撤回
- [ ] 转发群事件（禁言、加群、退群）
- [ ] 从 Matrix 侧发起私聊
  - [ ] 可检索的好友列表
- [ ] 群文件检索与下载

### 外观和易用性

- [X] 正确显示虚拟用户的头像和昵称
  - [ ] 定时刷新好友的头像和昵称，而非按需刷新
- [X] 同步其他客户端发送的消息
  - [ ] Double Puppeting（使用本地 Matrix 用户身份发送信息）
- [X] 消息发送失败提示
- [X] 文件发送进度显示

### 系统

- [X] 支持在线登入（link 指令）
  - [X] 支持密码登录
  - [ ] 支持 QR 码登录
- [ ] 断线提示
- [ ] 加密保存凭据并自动断线重连
- [ ] 定时删除临时文件

## 部署

1. [部署](https://matrix-org.github.io/synapse/latest/setup/installation.html) 一台 Matrix 服务器。

   > 本地测试和开发环境中推荐使用 Python module 方式部署，domain 可以使用 `localtest.me`，使用 8008 端口连接即可。
   >
2. clone 本项目到服务器，运行 `yarn install`和 `yarn build`。
3. 修改 `sample.config.yaml`：

   1. 将 `sample.config.yaml`复制为 `config.yaml`。
   2. 修改 Homeserver 相关信息（域名、URL）
   3. 修改 `provisioning.whitelist`，允许用户使用 Bridge。
4. 运行 `yarn start -r`生成配置文件 `oicq-registration.yaml`，复制它的路径备用。
5. 找到 Synapse 的配置文件 `homeserver.yaml`，加入下面的条目：

   ```yaml
   app_service_config_files:
     [
       "ABSOLUTE_PATH_TO_OICQ_REGISTRATION_YAML"
     ]
   ```
6. （可选）安装 [matrix-synapse-shared-secret-auth](https://github.com/devture/matrix-synapse-shared-secret-auth) 插件，并配置 `config.yaml`使用共享密钥。

   > 同步第三方客户端消息时，如果想要同步过来的消息以本地 Matrix 用户身份发送，需要安装此插件。
   > 注意，这个功能还没有经过测试，很可能完全无法使用。
   >
7. 运行 `synctl restart`重启 Synapse。
8. 运行 `yarn start`启动本服务。

## 使用

启动服务后，联络 `@_qq_bot:yourdomain.com`，输入 `link QQ 号 密码`进行帐号登录。

> **Warning**：Ticket 登录流程**没有经过测试**。如果登录异常，请检查控制台输出。

## 加入开发

本项目基于 [mx-puppet-bridge](https://gitlab.com/mx-puppet/mx-puppet-bridge) 和 [oicq](https://github.com/takayama-lily/oicq) 进行开发。

项目结构：

```
index.ts   ---- 程序入口，初始化 Bridge 并挂载协议钩子
oicq.ts    ---- 协议本体，实现消息转发等功能
message.ts ---- 消息格式处理
util.ts    ---- 杂项工具
```

供参阅的一些资料：

- [Types of bridging](https://matrix.org/docs/guides/types-of-bridging)
- [bridge.md](https://gitlab.com/mx-puppet/mx-puppet-bridge/-/blob/main/bridge.md)
